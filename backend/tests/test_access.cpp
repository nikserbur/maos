// Область права найма: начальник цеха работает только со своим цехом.
#include "AccessScope.h"
#include <gtest/gtest.h>

using maos::access::Op;
using maos::access::scope_error;

TEST(AccessScope, UnboundUserCannotHire) {
  EXPECT_FALSE(scope_error("", Op::Create, "", true, "shop-1").empty());
}

TEST(AccessScope, HireIntoOwnShopOrWithoutUnitIsAllowed) {
  EXPECT_TRUE(scope_error("shop-1", Op::Create, "", true, "shop-1").empty());
  EXPECT_TRUE(scope_error("shop-1", Op::Create, "", false, "").empty());   // цех подставит сервер
}

TEST(AccessScope, HireIntoForeignShopIsRejected) {
  EXPECT_FALSE(scope_error("shop-1", Op::Create, "", true, "shop-2").empty());
}

TEST(AccessScope, UpdateOnlyOwnWorkersAndNoTransferOut) {
  EXPECT_TRUE(scope_error("shop-1", Op::Update, "shop-1", false, "").empty());
  EXPECT_FALSE(scope_error("shop-1", Op::Update, "shop-2", false, "").empty());
  EXPECT_FALSE(scope_error("shop-1", Op::Update, "shop-1", true, "shop-2").empty());
}

TEST(AccessScope, DismissOnlyOwnWorkers) {
  EXPECT_TRUE(scope_error("shop-1", Op::Delete, "shop-1", false, "").empty());
  EXPECT_FALSE(scope_error("shop-1", Op::Delete, "shop-2", false, "").empty());
}
