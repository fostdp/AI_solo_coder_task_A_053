#include "tcp_server.h"
#include <iostream>
#include <thread>

namespace porcelain_monitor {

void TcpSession::start() {
    do_read();
}

void TcpSession::do_read() {
    auto self(shared_from_this());
    buffer_.resize(4096);
    socket_.async_read_some(
        boost::asio::buffer(buffer_),
        [this, self](boost::system::error_code ec, std::size_t bytes_transferred) {
            handle_read(ec, bytes_transferred);
        });
}

void TcpSession::handle_read(const boost::system::error_code& error,
                              size_t bytes_transferred) {
    if (!error) {
        data_.insert(data_.end(), buffer_.begin(), buffer_.begin() + bytes_transferred);

        while (data_.size() >= ProfinetParser::HEADER_SIZE + 4) {
            try {
                auto remote_endpoint = socket_.remote_endpoint();
                auto local_endpoint = socket_.local_endpoint();

                ProfinetPacket packet = parser_.parse(
                    data_,
                    remote_endpoint.address().to_string(),
                    local_endpoint.address().to_string());

                if (packet.frame_id == static_cast<uint16_t>(ProfinetParser::PacketType::LASER_DATA)) {
                    LaserMicroscopeData laser_data = parser_.parse_laser_data(packet.payload);
                    if (laser_callback_) {
                        laser_callback_(packet, laser_data);
                    }
                } else if (packet.frame_id == static_cast<uint16_t>(ProfinetParser::PacketType::VIBRATION_DATA)) {
                    VibrationData vib_data = parser_.parse_vibration_data(packet.payload);
                    if (vibration_callback_) {
                        vibration_callback_(packet, vib_data);
                    }
                }

                uint32_t cycle_counter = 0;
                if (data_.size() >= 8) {
                    cycle_counter = parser_.read_u32(data_, 4);
                }
                send_acknowledge(cycle_counter);

                size_t total_size = ProfinetParser::HEADER_SIZE + 4 + packet.payload.size();
                if (data_.size() >= total_size) {
                    data_.erase(data_.begin(), data_.begin() + total_size);
                } else {
                    break;
                }
            } catch (const std::exception& e) {
                std::cerr << "Error parsing PROFINET packet: " << e.what() << std::endl;
                data_.clear();
                break;
            }
        }

        do_read();
    } else if (error != boost::asio::error::eof) {
        std::cerr << "TCP session error: " << error.message() << std::endl;
    }
}

void TcpSession::send_acknowledge(uint32_t cycle_counter) {
    auto self(shared_from_this());
    auto ack = parser_.build_acknowledge(cycle_counter);

    boost::asio::async_write(
        socket_,
        boost::asio::buffer(ack),
        [self](boost::system::error_code ec, std::size_t) {
            if (ec) {
                std::cerr << "Error sending acknowledge: " << ec.message() << std::endl;
            }
        });
}

void UdpServer::start() {
    do_receive();
}

void UdpServer::do_receive() {
    auto self(shared_from_this());
    socket_.async_receive_from(
        boost::asio::buffer(recv_buffer_),
        remote_endpoint_,
        [this, self](boost::system::error_code ec, std::size_t bytes_transferred) {
            handle_receive(ec, bytes_transferred);
        });
}

void UdpServer::handle_receive(const boost::system::error_code& error,
                                size_t bytes_transferred) {
    if (!error && bytes_transferred > 0) {
        try {
            std::vector<uint8_t> data(recv_buffer_.begin(),
                                      recv_buffer_.begin() + bytes_transferred);

            auto local_endpoint = socket_.local_endpoint();
            ProfinetPacket packet = parser_.parse(
                data,
                remote_endpoint_.address().to_string(),
                local_endpoint.address().to_string());

            if (packet.frame_id == static_cast<uint16_t>(ProfinetParser::PacketType::LASER_DATA)) {
                LaserMicroscopeData laser_data = parser_.parse_laser_data(packet.payload);
                if (laser_callback_) {
                    laser_callback_(packet, laser_data);
                }
            } else if (packet.frame_id == static_cast<uint16_t>(ProfinetParser::PacketType::VIBRATION_DATA)) {
                VibrationData vib_data = parser_.parse_vibration_data(packet.payload);
                if (vibration_callback_) {
                    vibration_callback_(packet, vib_data);
                }
            }

            uint32_t cycle_counter = parser_.read_u32(data, 4);
            auto ack = parser_.build_acknowledge(cycle_counter);

            socket_.async_send_to(
                boost::asio::buffer(ack),
                remote_endpoint_,
                [](boost::system::error_code, std::size_t) {});

        } catch (const std::exception& e) {
            std::cerr << "Error parsing UDP PROFINET packet: " << e.what() << std::endl;
        }
    }

    do_receive();
}

ProfinetServer::ProfinetServer(boost::asio::io_context& io_context, uint16_t port)
    : io_context_(io_context),
      tcp_acceptor_(io_context, tcp::endpoint(tcp::v4(), port)) {
    udp_server_ = std::make_shared<UdpServer>(
        io_context, port,
        [this](const ProfinetPacket& p, const LaserMicroscopeData& d) {
            if (laser_callback_) laser_callback_(p, d);
        },
        [this](const ProfinetPacket& p, const VibrationData& d) {
            if (vibration_callback_) vibration_callback_(p, d);
        });
}

void ProfinetServer::start() {
    udp_server_->start();
    do_accept();
    std::cout << "PROFINET server started on port " << tcp_acceptor_.local_endpoint().port() << std::endl;
}

void ProfinetServer::stop() {
    boost::system::error_code ec;
    tcp_acceptor_.close(ec);
    std::lock_guard<std::mutex> lock(mutex_);
    sessions_.clear();
}

void ProfinetServer::do_accept() {
    tcp_acceptor_.async_accept(
        [this](boost::system::error_code ec, tcp::socket socket) {
            if (!ec) {
                auto session = std::make_shared<TcpSession>(
                    std::move(socket),
                    laser_callback_,
                    vibration_callback_);
                {
                    std::lock_guard<std::mutex> lock(mutex_);
                    sessions_.push_back(session);
                }
                session->start();
            }
            do_accept();
        });
}

void ProfinetServer::handle_accept(std::shared_ptr<TcpSession> session,
                                    const boost::system::error_code& error) {
    if (!error) {
        session->start();
    }
    do_accept();
}

}
