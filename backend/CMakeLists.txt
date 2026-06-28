cmake_minimum_required(VERSION 3.16)
project(maos_server CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Third-party (header-only, fetched at configure time) ──────────────────
include(FetchContent)

FetchContent_Declare(
  httplib
  GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
  GIT_TAG        v0.16.3
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(httplib)

FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        v3.11.3
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(nlohmann_json)

# ── SQLite3 ───────────────────────────────────────────────────────────────
find_package(SQLite3 REQUIRED)

# ── Target ────────────────────────────────────────────────────────────────
add_executable(maos_server
  src/main.cpp
  src/Database.cpp
  src/Optimizer.cpp
  src/Scheduler.cpp
)

target_include_directories(maos_server PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(maos_server PRIVATE
  httplib::httplib
  nlohmann_json::nlohmann_json
  SQLite3::SQLite3
)

if(UNIX AND NOT APPLE)
  target_link_libraries(maos_server PRIVATE pthread)
endif()

# Copy schema.sql next to the binary so the server can read it
configure_file(src/schema.sql ${CMAKE_BINARY_DIR}/schema.sql COPYONLY)
