"""
Legacy CSV-to-JSON update script retired.

Department ground truth no longer comes from valid_departments.txt. Use the
source-backed TypeScript seed flow in data-migration/seedDepartments.ts instead.
"""

raise SystemExit(
    "update_rdb.py is retired. Run `npx tsx data-migration/seedDepartments.ts` "
    "for a dry-run department audit, or add `--apply` to update MongoDB."
)
