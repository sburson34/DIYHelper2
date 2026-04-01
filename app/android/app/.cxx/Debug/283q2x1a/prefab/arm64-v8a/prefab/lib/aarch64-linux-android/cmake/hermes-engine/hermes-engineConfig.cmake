if(NOT TARGET hermes-engine::hermesvm)
add_library(hermes-engine::hermesvm SHARED IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
    IMPORTED_LOCATION "C:/Users/sburs/.gradle/caches/8.13/transforms/2766ba56a441ac8289d71558d718c705/transformed/jetified-hermes-android-0.14.0-debug/prefab/modules/hermesvm/libs/android.arm64-v8a/libhermesvm.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/sburs/.gradle/caches/8.13/transforms/2766ba56a441ac8289d71558d718c705/transformed/jetified-hermes-android-0.14.0-debug/prefab/modules/hermesvm/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

