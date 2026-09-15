#!/bin/sh

# Preflight is a hard gate. Once measurement starts, collect every diagnostic
# artifact even when the benchmark correctly returns non-zero for a missed
# acceptance threshold.
set -u

case "$#" in
  0)
    audit_stamp=$(date -u +%Y%m%dT%H%M%SZ)
    before_label="before-${audit_stamp}"
    after_label="after-${audit_stamp}"
    report_path="reports/token-audit-${audit_stamp}.md"
    ;;
  3)
    before_label=$1
    after_label=$2
    report_path=$3
    audit_stamp=${before_label#before-}
    ;;
  *)
    echo "Usage: npm run audit:run -- [before-label after-label reports/output.md]" >&2
    exit 2
    ;;
esac

evidence_directory="reports/audit-${audit_stamp}"

if [ "$before_label" = "$after_label" ]; then
  echo "Audit runner failed: labels must be distinct." >&2
  exit 2
fi

echo "Audit labels: $before_label -> $after_label"
echo "Audit logs: $evidence_directory"
echo "Audit report: $report_path"

npm run audit:preflight -- --evidence-id "$audit_stamp" || exit $?

audit_status=0
npm run audit:benchmark:pair -- --before "$before_label" --after "$after_label" --evidence-id "$audit_stamp" || {
  command_status=$?
  [ "$audit_status" -ne 0 ] || audit_status=$command_status
}
npm run audit:compare -- --before "$before_label" --after "$after_label" --evidence-id "$audit_stamp" || {
  command_status=$?
  [ "$audit_status" -ne 0 ] || audit_status=$command_status
}
npm run audit:dashboard || {
  command_status=$?
  [ "$audit_status" -ne 0 ] || audit_status=$command_status
}
npm run audit:report -- --before "$before_label" --after "$after_label" --out "$report_path" || {
  command_status=$?
  [ "$audit_status" -ne 0 ] || audit_status=$command_status
}

if [ "$audit_status" -eq 0 ]; then
  echo "Audit completed and passed acceptance: $report_path"
else
  echo "Audit artifacts collected; inspect the report and logs for invalidity or failed acceptance: $report_path" >&2
fi
exit "$audit_status"
