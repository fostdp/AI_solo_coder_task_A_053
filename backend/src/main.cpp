#include <iostream>
#include <memory>
#include <thread>
#include <vector>
#include <string>
#include <signal.h>
#include <boost/asio.hpp>
#include "config.h"
#include "config_loader.h"
#include "common.h"
#include "database.h"
#include "http_server.h"
#include "lockfree_queue.h"
#include "module_base.h"
#include "modules/profinet_parser_module.h"
#include "modules/fanout_module.h"
#include "modules/crack_router_module.h"
#include "modules/fatigue_predictor_module.h"
#include "modules/dem_simulator_module.h"
#include "modules/alert_ws_module.h"

namespace porcelain_monitor {

std::atomic<bool> g_running{true};

void signal_handler(int) {
    g_running = false;
    std::cout << "\nShutting down gracefully..." << std::endl;
}

class MonitorServer {
public:
    MonitorServer()
        : ioc_(std::thread::hardware_concurrency()),
          work_guard_(asio::make_work_guard(ioc_)) {}

    void init(const std::string& config_path) {
        cfg_ = config::ConfigLoader::load_from_file(config_path);
        auto& cfg = config::get_config();
        cfg = cfg_;
        cfg.apply_env();

        DatabaseManager::instance().init(
            cfg.database.host, cfg.database.port, cfg.database.name,
            cfg.database.user, cfg.database.password, cfg.database.pool_size);

        profinet_parser_ = std::make_unique<modules::ProfinetParserModule>(
            ioc_, cfg.server.profinet_port);

        laser_fanout_ = std::make_unique<modules::FanOutModule<ParsedLaserMessage>>("LaserFanOut");
        crack_router_ = std::make_unique<modules::CrackRouterModule>();
        crack_fanout_ = std::make_unique<modules::FanOutModule<CrackDetectionMessage>>("CrackFanOut");
        fatigue_predictor_ = std::make_unique<modules::FatiguePredictorModule>();
        dem_simulator_ = std::make_unique<modules::DemSimulatorModule>();
        alert_ws_ = std::make_unique<modules::AlertWsModule>(ioc_, cfg.server.websocket_port);

        alert_ws_->init(
            cfg.alerts.depth_threshold, cfg.alerts.width_threshold,
            cfg.alerts.sms_enabled, cfg.alerts.websocket_enabled,
            cfg.alerts.sms_gateway_url, cfg.alerts.alert_phone_number);

        http_server_ = std::make_shared<HttpServer>(ioc_, cfg.server.http_port, "../frontend");

        wire_pipeline();
    }

    void wire_pipeline() {
        auto laser_q_alert = concurrency::make_queue<ParsedLaserMessage>();
        auto laser_q_router = concurrency::make_queue<ParsedLaserMessage>();
        auto crack_q_fatigue = concurrency::make_queue<CrackDetectionMessage>();
        auto crack_q_dem = concurrency::make_queue<CrackDetectionMessage>();
        auto prediction_q = concurrency::make_queue<FatiguePredictionMessage>();
        auto dem_q = concurrency::make_queue<DemSimulationMessage>();
        auto vibration_q = concurrency::make_queue<ParsedVibrationMessage>();

        profinet_parser_->set_laser_output(laser_fanout_->input());
        profinet_parser_->set_vibration_output(vibration_q);

        laser_fanout_->set_output(laser_q_alert);
        laser_fanout_->add_output(laser_q_router);

        crack_router_->set_input(laser_q_router);
        crack_router_->set_output(crack_fanout_->input());

        crack_fanout_->set_output(crack_q_fatigue);
        crack_fanout_->add_output(crack_q_dem);

        fatigue_predictor_->set_input(crack_q_fatigue);
        fatigue_predictor_->set_output(prediction_q);

        dem_simulator_->set_input(crack_q_dem);
        dem_simulator_->set_output(dem_q);

        alert_ws_->set_laser_input(laser_q_alert);
        alert_ws_->set_vibration_input(vibration_q);
        alert_ws_->set_prediction_input(prediction_q);
        alert_ws_->set_dem_input(dem_q);
    }

    void start() {
        profinet_parser_->start();
        laser_fanout_->start();
        crack_router_->start();
        crack_fanout_->start();
        fatigue_predictor_->start();
        dem_simulator_->start();
        alert_ws_->start();
        http_server_->start();

        for (int i = 0; i < cfg_.server.thread_pool_size; ++i) {
            io_threads_.emplace_back([this]() {
                while (g_running) {
                    try { ioc_.run(); }
                    catch (const std::exception& e) {
                        std::cerr << "IO Thread exception: " << e.what() << std::endl;
                    }
                }
            });
        }

        print_banner();
    }

    void stop() {
        g_running = false;
        work_guard_.reset();

        profinet_parser_->stop();
        laser_fanout_->stop();
        crack_router_->stop();
        crack_fanout_->stop();
        fatigue_predictor_->stop();
        dem_simulator_->stop();
        alert_ws_->stop();
        http_server_->stop();

        ioc_.stop();

        for (auto& t : io_threads_) {
            if (t.joinable()) t.join();
        }
    }

    void join() {
        for (auto& t : io_threads_) {
            if (t.joinable()) t.join();
        }
    }

    void print_stats() {
        std::cout << "\n--- Module Stats ---" << std::endl;
        std::cout << "[LaserFanOut] processed: "   << laser_fanout_->processed_count()     << std::endl;
        std::cout << "[CrackRouter]  processed: "   << crack_router_->processed_count()     << std::endl;
        std::cout << "[CrackFanOut]  processed: "   << crack_fanout_->processed_count()     << std::endl;
        std::cout << "[FatiguePred]  processed: "   << fatigue_predictor_->processed_count() << std::endl;
        std::cout << "[DEM Sim]      processed: "   << dem_simulator_->processed_count()    << std::endl;
        std::cout << "[Alert+WS]     processed: "   << alert_ws_->processed_count()         << std::endl;
    }

private:
    void print_banner() {
        std::cout << "========================================" << std::endl;
        std::cout << "  古代瓷器釉面裂纹监测系统 (模块化)" << std::endl;
        std::cout << "========================================" << std::endl;
        std::cout << "PROFINET Parser:   Port " << cfg_.server.profinet_port << std::endl;
        std::cout << "HTTP Server:       Port " << cfg_.server.http_port << std::endl;
        std::cout << "WebSocket Server:  Port " << cfg_.server.websocket_port << std::endl;
        std::cout << "IO Threads:        "     << cfg_.server.thread_pool_size << std::endl;
        std::cout << "Pipeline:" << std::endl;
        std::cout << "  ProfinetParser → LaserFanOut ─┬→ AlertWsModule" << std::endl;
        std::cout << "                                └→ CrackRouter ─┬→ FatiguePredictor → AlertWsModule" << std::endl;
        std::cout << "                                                 └→ DemSimulator → AlertWsModule" << std::endl;
        std::cout << "  ProfinetParser → Vibration → AlertWsModule" << std::endl;
        std::cout << "========================================" << std::endl;
    }

    asio::io_context ioc_;
    asio::executor_work_guard<asio::io_context::executor_type> work_guard_;
    std::vector<std::thread> io_threads_;
    config::Config cfg_;

    std::unique_ptr<modules::ProfinetParserModule> profinet_parser_;
    std::unique_ptr<modules::FanOutModule<ParsedLaserMessage>> laser_fanout_;
    std::unique_ptr<modules::CrackRouterModule> crack_router_;
    std::unique_ptr<modules::FanOutModule<CrackDetectionMessage>> crack_fanout_;
    std::unique_ptr<modules::FatiguePredictorModule> fatigue_predictor_;
    std::unique_ptr<modules::DemSimulatorModule> dem_simulator_;
    std::unique_ptr<modules::AlertWsModule> alert_ws_;
    std::shared_ptr<HttpServer> http_server_;
};

}

int main(int argc, char* argv[]) {
    using namespace porcelain_monitor;

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    std::string config_path = "config.json";
    if (argc >= 2) {
        config_path = argv[1];
    }

    try {
        MonitorServer server;
        server.init(config_path);
        server.start();

        std::cout << "Press Ctrl+C to stop (or 's' for stats)..." << std::endl;

        while (g_running) {
            std::this_thread::sleep_for(std::chrono::seconds(2));
        }

        server.print_stats();
        server.stop();
        std::cout << "Server stopped successfully." << std::endl;

    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}
