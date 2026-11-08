# Zoom Meeting SDK の初期化・認証だけを確かめる検証プログラム。
# SDK は Git 管理外に置き、ZOOM_SDK_DIR で場所を渡す（例: /opt/zoom-sdk）。
cmake_minimum_required(VERSION 3.22)
project(wacha_zoom_auth_probe CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT ZOOM_SDK_DIR)
  message(FATAL_ERROR "ZOOM_SDK_DIR を指定してください")
endif()

find_package(PkgConfig REQUIRED)
pkg_check_modules(GLIB REQUIRED glib-2.0)

add_executable(wacha-zoom-auth-probe main.cpp)
target_include_directories(wacha-zoom-auth-probe PRIVATE ${ZOOM_SDK_DIR}/h ${GLIB_INCLUDE_DIRS})
target_compile_options(wacha-zoom-auth-probe PRIVATE -Wall -Wextra)
target_link_directories(wacha-zoom-auth-probe PRIVATE ${ZOOM_SDK_DIR})
target_link_libraries(wacha-zoom-auth-probe PRIVATE meetingsdk ${GLIB_LIBRARIES})
# 実行時はコンテナ内の /opt/zoom-sdk から SDK を読む
set_target_properties(wacha-zoom-auth-probe PROPERTIES BUILD_RPATH "/opt/zoom-sdk" INSTALL_RPATH "/opt/zoom-sdk")
