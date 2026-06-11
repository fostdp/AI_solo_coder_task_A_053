#pragma once

#include <string>
#include <cstdint>

namespace porcelain_monitor {
namespace config {

struct DatabaseConfig {
    std::string host = "localhost";
    uint16_t port = 5432;
    std::string name = "porcelain_monitor";
    std::string user = "postgres";
    std::string password = "postgres";
    int pool_size = 10;
};

struct ServerConfig {
    uint16_t profinet_port = 34964;
    uint16_t http_port = 8080;
    uint16_t websocket_port = 8081;
    std::string bind_address = "0.0.0.0";
    int thread_pool_size = 8;
};

struct AlertConfig {
    double depth_threshold = 200.0;
    double width_threshold = 50.0;
    bool sms_enabled = true;
    bool websocket_enabled = true;
    std::string sms_gateway_url = "http://sms-gateway.example.com/send";
    std::string alert_phone_number = "+8613800138000";
};

struct AlgorithmConfig {
    struct ParisLaw {
        double default_C = 1.5e-10;
        double default_m = 3.0;
        double stress_ratio = 0.1;
        int prediction_horizon_hours = 720;
    } paris_law;

    struct DEM {
        double particle_radius_nm = 25.0;
        double youngs_modulus = 70e9;
        double poissons_ratio = 0.22;
        double density = 3950.0;
        int max_particles = 10000;
        int simulation_steps = 1000;
        double time_step = 1e-9;
    } dem;
};

struct Config {
    DatabaseConfig database;
    ServerConfig server;
    AlertConfig alerts;
    AlgorithmConfig algorithms;
};

inline Config& get_config() {
    static Config config;
    return config;
}

}
}
