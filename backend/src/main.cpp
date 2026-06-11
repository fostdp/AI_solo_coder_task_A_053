#include <iostream>
#include <memory>
#include <thread>
#include <vector>
#include <signal.h>
#include <boost/asio.hpp>
#include "config.h"
#include "common.h"
#include "tcp_server.h"
#include "database.h"
#include "alert_manager.h"
#include "websocket_server.h"
#include "http_server.h"
#include "crack_propagation.h"
#include "dem_simulation.h"

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

    void init() {
        auto& cfg = config::get_config();

        DatabaseManager::instance().init(
            cfg.database.host,
            cfg.database.port,
            cfg.database.name,
            cfg.database.user,
            cfg.database.password,
            cfg.database.pool_size
        );

        alert_manager_ = std::make_unique<AlertManager>();
        alert_manager_->init(
            cfg.alerts.depth_threshold,
            cfg.alerts.width_threshold,
            cfg.alerts.sms_enabled,
            cfg.alerts.websocket_enabled,
            cfg.alerts.sms_gateway_url,
            cfg.alerts.alert_phone_number
        );

        profinet_server_ = std::make_unique<ProfinetServer>(
            ioc_, cfg.server.profinet_port);

        profinet_server_->set_laser_callback(
            [this](const ProfinetPacket& packet, const LaserMicroscopeData& data) {
                handle_laser_data(packet, data);
            });

        profinet_server_->set_vibration_callback(
            [this](const ProfinetPacket& packet, const VibrationData& data) {
                handle_vibration_data(packet, data);
            });

        websocket_server_ = std::make_shared<WebSocketServer>(
            ioc_, cfg.server.websocket_port);

        alert_manager_->set_websocket_server(websocket_server_.get());

        http_server_ = std::make_shared<HttpServer>(
            ioc_, cfg.server.http_port, "../frontend");
    }

    void start() {
        profinet_server_->start();
        websocket_server_->start();
        http_server_->start();
        alert_manager_->start();

        std::cout << "========================================" << std::endl;
        std::cout << "  古代瓷器釉面裂纹监测系统" << std::endl;
        std::cout << "========================================" << std::endl;
        std::cout << "PROFINET Server: Port " << config::get_config().server.profinet_port << std::endl;
        std::cout << "HTTP Server:     Port " << config::get_config().server.http_port << std::endl;
        std::cout << "WebSocket Server: Port " << config::get_config().server.websocket_port << std::endl;
        std::cout << "========================================" << std::endl;

        for (int i = 0; i < config::get_config().server.thread_pool_size; ++i) {
            threads_.emplace_back([this]() {
                while (g_running) {
                    try {
                        ioc_.run();
                    } catch (const std::exception& e) {
                        std::cerr << "Thread exception: " << e.what() << std::endl;
                    }
                }
            });
        }
    }

    void stop() {
        g_running = false;
        work_guard_.reset();

        profinet_server_->stop();
        websocket_server_->stop();
        http_server_->stop();
        alert_manager_->stop();

        ioc_.stop();

        for (auto& t : threads_) {
            if (t.joinable()) {
                t.join();
            }
        }
    }

    void join() {
        for (auto& t : threads_) {
            if (t.joinable()) {
                t.join();
            }
        }
    }

private:
    void handle_laser_data(const ProfinetPacket& packet, const LaserMicroscopeData& data) {
        try {
            DatabaseManager::instance().log_profinet_packet(
                packet.source_ip, packet.destination_ip,
                packet.frame_id, packet.payload);

            int64_t data_id = DatabaseManager::instance().insert_laser_data(data);

            if (data.crack_detected) {
                for (const auto& crack : data.cracks) {
                    CrackInfo saved_crack = crack;
                    saved_crack.crack_code = "CRK-" + std::to_string(data.porcelain_id) +
                        "-" + std::to_string(std::chrono::system_clock::to_time_t(
                            std::chrono::system_clock::now()));
                    saved_crack.detected_at = data.measurement_time;

                    int64_t crack_id = DatabaseManager::instance().insert_crack(
                        saved_crack, data.porcelain_id);

                    if (crack_id > 0) {
                        DatabaseManager::instance().insert_crack_points(
                            crack_id, crack.points);
                    }
                }
            }

            alert_manager_->check_laser_data(data);

            nlohmann::json j;
            j["type"] = "laser_data";
            j["data"] = {
                {"sensor_id", data.sensor_id},
                {"porcelain_id", data.porcelain_id},
                {"crack_detected", data.crack_detected},
                {"crack_count", data.crack_count}
            };
            websocket_server_->broadcast_json(j);

        } catch (const std::exception& e) {
            std::cerr << "Error handling laser data: " << e.what() << std::endl;
        }
    }

    void handle_vibration_data(const ProfinetPacket& packet, const VibrationData& data) {
        try {
            DatabaseManager::instance().log_profinet_packet(
                packet.source_ip, packet.destination_ip,
                packet.frame_id, packet.payload);

            DatabaseManager::instance().insert_vibration_data(data);

            alert_manager_->check_vibration_data(data);

            nlohmann::json j;
            j["type"] = "vibration_data";
            j["data"] = {
                {"sensor_id", data.sensor_id},
                {"porcelain_id", data.porcelain_id},
                {"rms_value", data.rms_value},
                {"peak_value", data.peak_value},
                {"temperature", data.temperature},
                {"humidity", data.humidity}
            };
            websocket_server_->broadcast_json(j);

        } catch (const std::exception& e) {
            std::cerr << "Error handling vibration data: " << e.what() << std::endl;
        }
    }

    asio::io_context ioc_;
    asio::executor_work_guard<asio::io_context::executor_type> work_guard_;
    std::vector<std::thread> threads_;

    std::unique_ptr<ProfinetServer> profinet_server_;
    std::shared_ptr<WebSocketServer> websocket_server_;
    std::shared_ptr<HttpServer> http_server_;
    std::unique_ptr<AlertManager> alert_manager_;
};

}

int main(int argc, char* argv[]) {
    using namespace porcelain_monitor;

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    try {
        MonitorServer server;
        server.init();
        server.start();

        std::cout << "Press Ctrl+C to stop..." << std::endl;

        while (g_running) {
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }

        server.stop();
        std::cout << "Server stopped successfully." << std::endl;

    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}
