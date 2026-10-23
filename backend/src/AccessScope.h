#pragma once
/**
 * Область действия права найма (HIRE_WORKERS): начальник цеха принимает, переводит
 * и увольняет сотрудников ТОЛЬКО своего цеха. Право EDIT_NSI (администратор/технолог)
 * области не имеет. Чистая функция — проверяется юнит-тестами (test_access.cpp).
 */
#include <string>

namespace maos::access {

enum class Op { Create, Update, Delete };

/**
 * Пустая строка — операция разрешена; иначе — понятная причина отказа (для 403).
 * scope      — цех пользователя (users.org_unit_id);
 * rowUnit    — цех записи до изменения (для Update/Delete);
 * bodyUnit   — цех в теле запроса (для Create/Update), bodyHasUnit — поле передано.
 */
inline std::string scope_error(const std::string& scope, Op op, const std::string& rowUnit,
                               bool bodyHasUnit, const std::string& bodyUnit) {
  if (scope.empty()) return "Пользователь не привязан к цеху — найм недоступен";
  if (op != Op::Create && rowUnit != scope) return "Сотрудник числится в другом цехе";
  if (op != Op::Delete && bodyHasUnit && !bodyUnit.empty() && bodyUnit != scope)
    return "Нанимать и переводить можно только в свой цех";
  return "";
}

}  // namespace maos::access
