#pragma once
#ifdef __cplusplus
#include <folly/Format.h>
#include <string>
namespace std {
  template <typename... Args>
  std::string format(Args&&... args) {
    return folly::format(std::forward<Args>(args)...).str();
  }
}
#endif
