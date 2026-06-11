#include <iostream>
#include <memory>
#include <thread>
#include <chrono>
#include <random>
#include <vector>
#include <cstring>
#include <boost/asio.hpp>
#include "../backend/include/profinet_parser.h"
#include "../backend/include/common.h"

namespace porcelain_monitor {
namespace simulator {

using boost::asio::ip::tcp;
using boost::asio::ip::udp;

struct SensorConfig {
    int id;
    std::string name;
    int porcelain_id;
    std::string type;
    std::string server_ip;
    uint16_t server_port;
    int interval_ms;
};

class ProfinetClient {
public:
    ProfinetClient(boost::asio::io_context& ioc, const SensorConfig& config)
        : ioc_(ioc),
          socket_(ioc),
          config_(config),
          cycle_counter_(0),
          running_(false) {}

    void start() {
        running_ = true;
        connect();
    }

    void stop() {
        running_ = false;
        boost::system::error_code ec;
        socket_.close(ec);
        if (timer_) {
            timer_->cancel();
        }
    }

private:
    void connect() {
        tcp::endpoint endpoint(boost::asio::ip::make_address(config_.server_ip),
                               config_.server_port);

        socket_.async_connect(endpoint,
            [this](boost::system::error_code ec) {
                if (!ec) {
                    std::cout << "[" << config_.name << "] 连接到服务器成功" << std::endl;
                    start_sending();
                } else {
                    std::cerr << "[" << config_.name << "] 连接失败: " << ec.message() << std::endl;
                    if (running_) {
                        std::this_thread::sleep_for(std::chrono::seconds(5));
                        connect();
                    }
                }
            });
    }

    void start_sending() {
        timer_ = std::make_unique<boost::asio::steady_timer>(ioc_);
        schedule_next_send();
    }

    void schedule_next_send() {
        if (!running_) return;

        timer_->expires_after(std::chrono::milliseconds(config_.interval_ms));
        timer_->async_wait(
            [this](boost::system::error_code ec) {
                if (!ec && running_) {
                    send_data();
                    schedule_next_send();
                }
            });
    }

    void send_data() {
        cycle_counter_++;

        std::vector<uint8_t> payload;
        if (config_.type == "LASER") {
            payload = build_laser_payload();
        } else {
            payload = build_vibration_payload();
        }

        std::vector<uint8_t> packet = build_profinet_packet(
            config_.type == "LASER" ? 0x8001 : 0x8002, payload);

        boost::asio::async_write(socket_,
            boost::asio::buffer(packet),
            [this](boost::system::error_code ec, std::size_t) {
                if (ec) {
                    std::cerr << "[" << config_.name << "] 发送失败: " << ec.message() << std::endl;
                }
            });

        if (cycle_counter_ % 10 == 0) {
            std::cout << "[" << config_.name << "] 已发送 " << cycle_counter_
                      << " 个数据包" << std::endl;
        }
    }

    std::vector<uint8_t> build_laser_payload() {
        std::vector<uint8_t> payload;
        std::mt19937 rng(std::random_device{}());
        std::normal_distribution<> depth_dist(150, 50);
        std::normal_distribution<> width_dist(40, 15);
        std::uniform_real_distribution<> pos_dist(-10.0, 10.0);

        uint32_t sensor_id = static_cast<uint32_t>(config_.id);
        uint32_t porcelain_id = static_cast<uint32_t>(config_.porcelain_id);

        append_u32(payload, sensor_id);
        append_u32(payload, porcelain_id);

        uint64_t timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        append_u64(payload, timestamp);

        append_double(payload, 0.0);
        append_double(payload, 0.0);
        append_double(payload, 20.0);
        append_double(payload, 20.0);
        append_double(payload, 0.1e-6);

        bool crack_detected = (cycle_counter_ % 3 == 0) || (depth_dist(rng) > 200);
        payload.push_back(crack_detected ? 1 : 0);

        uint32_t crack_count = crack_detected ?
            (std::uniform_int_distribution<>(1, 3)(rng)) : 0;
        append_u32(payload, crack_count);

        for (uint32_t i = 0; i < crack_count; ++i) {
            double max_depth = std::abs(depth_dist(rng));
            double max_width = std::abs(width_dist(rng));
            double total_length = 5.0 + std::abs(std::normal_distribution<>(10.0, 5.0)(rng));

            append_double(payload, max_depth);
            append_double(payload, max_width);
            append_double(payload, total_length);

            uint32_t point_count = 20 + std::uniform_int_distribution<>(0, 30)(rng);
            append_u32(payload, point_count);

            for (uint32_t j = 0; j < point_count; ++j) {
                double t = static_cast<double>(j) / (point_count - 1);
                double x = pos_dist(rng);
                double y = pos_dist(rng);
                double z = pos_dist(rng);
                double depth = max_depth * (0.3 + 0.7 * std::sin(M_PI * t));
                double width = max_width * (0.5 + 0.5 * std::sin(M_PI * t));

                append_double(payload, x);
                append_double(payload, y);
                append_double(payload, z);
                append_double(payload, depth);
                append_double(payload, width);

                append_double(payload, 0.0);
                append_double(payload, 0.0);
                append_double(payload, 1.0);

                append_double(payload, 0.01);
            }
        }

        json processed;
        processed["scan_quality"] = 0.95;
        processed["noise_level"] = 0.02;
        std::string json_str = processed.dump();
        append_u32(payload, static_cast<uint32_t>(json_str.size()));
        payload.insert(payload.end(), json_str.begin(), json_str.end());

        return payload;
    }

    std::vector<uint8_t> build_vibration_payload() {
        std::vector<uint8_t> payload;
        std::mt19937 rng(std::random_device{}());
        std::normal_distribution<> rms_dist(1.0e-7, 5.0e-8);
        std::normal_distribution<> peak_dist(5.0e-7, 2.0e-7);
        std::normal_distribution<> temp_dist(22.0, 1.0);
        std::normal_distribution<> hum_dist(50.0, 5.0);

        uint32_t sensor_id = static_cast<uint32_t>(config_.id + 20);
        uint32_t porcelain_id = static_cast<uint32_t>(config_.porcelain_id);

        append_u32(payload, sensor_id);
        append_u32(payload, porcelain_id);

        uint64_t timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        append_u64(payload, timestamp);

        double rms = std::abs(rms_dist(rng));
        double peak = std::abs(peak_dist(rng));
        double dom_freq = 50.0 + std::normal_distribution<>(0, 5.0)(rng);

        append_double(payload, rms);
        append_double(payload, peak);
        append_double(payload, dom_freq);

        float temp = static_cast<float>(temp_dist(rng));
        float hum = static_cast<float>(hum_dist(rng));
        append_float(payload, temp);
        append_float(payload, hum);

        uint32_t amp_count = 100;
        append_u32(payload, amp_count);
        for (uint32_t i = 0; i < amp_count; ++i) {
            double freq = i * 10.0;
            double amp = rms * std::exp(-freq / 500.0) *
                (1.0 + 0.1 * std::normal_distribution<>()(rng));
            append_double(payload, amp);
        }

        json spectrum;
        spectrum["peak_frequencies"] = {50.0, 150.0, 250.0};
        spectrum["harmonic_distortion"] = 0.05;
        std::string json_str = spectrum.dump();
        append_u32(payload, static_cast<uint32_t>(json_str.size()));
        payload.insert(payload.end(), json_str.begin(), json_str.end());

        return payload;
    }

    std::vector<uint8_t> build_profinet_packet(uint16_t frame_id,
                                                const std::vector<uint8_t>& payload) {
        std::vector<uint8_t> packet;

        append_u16(packet, frame_id);
        packet.push_back(0x01);
        packet.push_back(0x01);
        append_u32(packet, cycle_counter_);

        uint64_t timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        append_u64(packet, timestamp);

        append_u16(packet, 0x0001);
        append_u16(packet, static_cast<uint16_t>(payload.size()));

        packet.push_back(0x00);
        packet.push_back(0x00);
        packet.push_back(0x00);
        packet.push_back(0x00);

        packet.insert(packet.end(), payload.begin(), payload.end());

        return packet;
    }

    void append_u16(std::vector<uint8_t>& buf, uint16_t value) {
        buf.push_back(static_cast<uint8_t>(value & 0xFF));
        buf.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
    }

    void append_u32(std::vector<uint8_t>& buf, uint32_t value) {
        for (int i = 0; i < 4; ++i) {
            buf.push_back(static_cast<uint8_t>((value >> (i * 8)) & 0xFF));
        }
    }

    void append_u64(std::vector<uint8_t>& buf, uint64_t value) {
        for (int i = 0; i < 8; ++i) {
            buf.push_back(static_cast<uint8_t>((value >> (i * 8)) & 0xFF));
        }
    }

    void append_float(std::vector<uint8_t>& buf, float value) {
        uint32_t int_val;
        std::memcpy(&int_val, &value, sizeof(float));
        append_u32(buf, int_val);
    }

    void append_double(std::vector<uint8_t>& buf, double value) {
        uint64_t int_val;
        std::memcpy(&int_val, &value, sizeof(double));
        append_u64(buf, int_val);
    }

    boost::asio::io_context& ioc_;
    tcp::socket socket_;
    SensorConfig config_;
    uint32_t cycle_counter_;
    std::atomic<bool> running_;
    std::unique_ptr<boost::asio::steady_timer> timer_;
};

}
}

int main(int argc, char* argv[]) {
    using namespace porcelain_monitor::simulator;

    std::string server_ip = "127.0.0.1";
    uint16_t server_port = 34964;
    int interval_ms = 10800000;

    if (argc >= 2) server_ip = argv[1];
    if (argc >= 3) server_port = static_cast<uint16_t>(std::atoi(argv[2]));
    if (argc >= 4) interval_ms = std::atoi(argv[3]);

    std::cout << "========================================" << std::endl;
    std::cout << "  PROFINET 传感器模拟器" << std::endl;
    std::cout << "========================================" << std::endl;
    std::cout << "服务器地址: " << server_ip << ":" << server_port << std::endl;
    std::cout << "发送间隔: " << interval_ms << "ms ("
              << interval_ms / 1000 << "秒)" << std::endl;

    boost::asio::io_context ioc;
    std::vector<std::unique_ptr<ProfinetClient>> clients;

    for (int i = 1; i <= 20; ++i) {
        SensorConfig cfg;
        cfg.id = i;
        cfg.name = "激光共聚焦显微镜 #" + std::to_string(i);
        cfg.porcelain_id = i;
        cfg.type = "LASER";
        cfg.server_ip = server_ip;
        cfg.server_port = server_port;
        cfg.interval_ms = interval_ms + (i % 5) * 1000;

        auto client = std::make_unique<ProfinetClient>(ioc, cfg);
        client->start();
        clients.push_back(std::move(client));
    }

    for (int i = 1; i <= 40; ++i) {
        SensorConfig cfg;
        cfg.id = i;
        cfg.name = "微振动传感器 #" + std::to_string(i);
        cfg.porcelain_id = ((i - 1) % 200) + 1;
        cfg.type = "VIBRATION";
        cfg.server_ip = server_ip;
        cfg.server_port = server_port;
        cfg.interval_ms = interval_ms + (i % 5) * 1000;

        auto client = std::make_unique<ProfinetClient>(ioc, cfg);
        client->start();
        clients.push_back(std::move(client));
    }

    std::cout << "已启动 20 台激光共聚焦显微镜模拟器" << std::endl;
    std::cout << "已启动 40 台微振动传感器模拟器" << std::endl;
    std::cout << "========================================" << std::endl;
    std::cout << "按 Ctrl+C 停止..." << std::endl;

    std::vector<std::thread> threads;
    for (int i = 0; i < 4; ++i) {
        threads.emplace_back([&ioc]() {
            ioc.run();
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    return 0;
}
