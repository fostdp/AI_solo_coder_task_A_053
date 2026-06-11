#pragma once

#include <vector>
#include <cmath>
#include <nlohmann/json.hpp>
#include "common.h"
#include "config.h"

namespace porcelain_monitor {
namespace algorithms {

struct ParisLawParameters {
    double C = 1.5e-10;
    double m = 3.0;
    double stress_ratio_R = 0.1;
    double initial_crack_length = 0.0;
    double maximum_stress = 25.0e6;
    double minimum_stress = 2.5e6;
    double fracture_toughness = 1.0e6;
    double geometric_factor_Y = 1.0;
    double cyclic_frequency = 1.0 / 10800.0;
};

struct ParisLawResult {
    std::vector<double> time_hours;
    std::vector<double> crack_length;
    std::vector<double> crack_depth;
    std::vector<double> crack_width;
    std::vector<double> stress_intensity_range;
    std::vector<double> crack_growth_rate;
    double predicted_length_720h = 0.0;
    double predicted_depth_720h = 0.0;
    double predicted_width_720h = 0.0;
    double time_to_failure_hours = -1.0;
    double confidence = 0.85;
    std::string risk_level = "LOW";
    ParisLawParameters parameters;
};

class CrackPropagationModel {
public:
    CrackPropagationModel() = default;
    ~CrackPropagationModel() = default;

    void set_parameters(const ParisLawParameters& params) { params_ = params; }
    const ParisLawParameters& get_parameters() const { return params_; }

    ParisLawResult predict(const CrackInfo& crack,
                           int time_horizon_hours = 720,
                           int time_steps = 100);

    ParisLawResult predict_with_history(const CrackInfo& crack,
                                        const std::vector<CrackInfo>& history,
                                        int time_horizon_hours = 720);

    double calculate_stress_intensity(double crack_length, double stress) const;
    double calculate_crack_growth_rate(double delta_K) const;
    double estimate_remaining_life(double initial_length,
                                   double critical_length) const;

    std::string assess_risk_level(const ParisLawResult& result) const;

    nlohmann::json result_to_json(const ParisLawResult& result) const;

    void calibrate_with_measurement(const std::vector<double>& times,
                                    const std::vector<double>& lengths);

private:
    ParisLawParameters params_;

    double runge_kutta_step(double a, double t, double dt) const;
    double critical_crack_length() const;
    double interpolate_history(const std::vector<double>& times,
                               const std::vector<double>& values,
                               double target_time) const;
};

}
}
