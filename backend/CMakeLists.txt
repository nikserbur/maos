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

# ── HiGHS (MIT) — LP-решатель точной модели CVaR Стадии 2 (ExactCvar.*) ────
# Статическая библиотека; исполняемый файл, тесты, примеры и zlib HiGHS отключены
# (быстрее сборка, нет лишних целей в ctest). Версия закреплена тегом релиза.
FetchContent_Declare(
  highs
  GIT_REPOSITORY https://github.com/ERGO-Code/HiGHS.git
  GIT_TAG        v1.15.1
  GIT_SHALLOW    TRUE
)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING     OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES    OFF CACHE BOOL "" FORCE)
set(BUILD_CXX_EXE     OFF CACHE BOOL "" FORCE)
set(ZLIB              OFF CACHE BOOL "" FORCE)
set(FAST_BUILD        ON  CACHE BOOL "" FORCE)
set(HIPO              OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_EXTRAS_LIB OFF CACHE BOOL "" FORCE)  # без dlopen-заглушки extras
FetchContent_MakeAvailable(highs)

# ── SQLite3 ───────────────────────────────────────────────────────────────
find_package(SQLite3 REQUIRED)

# ── Targets ───────────────────────────────────────────────────────────────
# Ядро (БД + Стадия 1/2) — общая статическая библиотека сервера и тестов, чтобы
# тесты проверяли ровно тот же объектный код, что работает в сервере.
add_library(maos_core STATIC
  src/CashLp.cpp
  src/CashOptimize.cpp
  src/CashWaterfall.cpp
  src/Database.cpp
  src/ExactCvar.cpp
  src/GaImprover.cpp
  src/MacroSampler.cpp
  src/Optimizer.cpp
  src/Passport.cpp
  src/Scheduler.cpp
)
target_include_directories(maos_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
# Волна M: MacroSampler обязан воспроизводить rl/macro/sample.py побитово — без слияния
# умножения-сложения в FMA (порядок операций фиксирован в обоих файлах).
set_source_files_properties(src/MacroSampler.cpp PROPERTIES COMPILE_OPTIONS "-ffp-contract=off")
target_link_libraries(maos_core PUBLIC
  nlohmann_json::nlohmann_json
  SQLite3::SQLite3
)
target_link_libraries(maos_core PRIVATE highs::highs)
if(UNIX AND NOT APPLE)
  target_link_libraries(maos_core PUBLIC pthread)
endif()

add_executable(maos_server
  src/main.cpp
)

target_include_directories(maos_server PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(maos_server PRIVATE
  maos_core
  httplib::httplib
)

# ── Tests (GoogleTest, regression tests for the methodology fixes) ────────
option(MAOS_BUILD_TESTS "Build maos_tests (GoogleTest)" ON)
if(MAOS_BUILD_TESTS)
  FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG        v1.15.2
    GIT_SHALLOW    TRUE
  )
  set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
  set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
  set(BUILD_GMOCK OFF CACHE BOOL "" FORCE)
  FetchContent_MakeAvailable(googletest)

  enable_testing()
  add_executable(maos_tests
    tests/test_cashlp.cpp
    tests/test_cashwaterfall.cpp
    tests/test_finance.cpp
    tests/test_ga.cpp
    tests/test_macrosampler.cpp
    tests/test_optimizer.cpp
    tests/test_planmath.cpp
    tests/test_scheduler.cpp
  )
  target_link_libraries(maos_tests PRIVATE maos_core GTest::gtest_main)
  target_compile_definitions(maos_tests PRIVATE MAOS_TEST_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")
  include(GoogleTest)
  gtest_discover_tests(maos_tests DISCOVERY_TIMEOUT 60)
endif()

# Copy schema.sql next to the binary so the server can read it
configure_file(src/schema.sql ${CMAKE_BINARY_DIR}/schema.sql COPYONLY)
