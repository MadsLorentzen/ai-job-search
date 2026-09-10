"""Classify reviewed posting facts; never infer missing eligibility or pay data."""
import argparse
import json
import math
from datetime import date
from urllib.parse import urlsplit
from pathlib import Path


def classify(job, floor=4500):
    fail, flags = [], []
    evidence = job.get('evidence', {})
    if not isinstance(evidence, dict):
        raise ValueError('evidence must be an object')
    for field in ('remote', 'brazil_eligible', 'paid_in_usd'):
        value = job.get(field)
        if value is not None and type(value) is not bool:
            raise ValueError(f'{field} must be true, false or null')
        if value is False:
            fail.append(field)
        elif value is None or not evidence.get(field):
            flags.append(field + ': confirmation/evidence missing')
    url = job.get('source_url', '')
    if not isinstance(url, str) or urlsplit(url).scheme != 'https' or not urlsplit(url).hostname:
        flags.append('source URL missing or invalid')
    try:
        checked = date.fromisoformat(job.get('checked_date', ''))
        if checked > date.today():
            flags.append('checked date is in the future')
    except (TypeError, ValueError):
        flags.append('checked date missing or invalid')
    salary = job.get('salary') or {}
    if not isinstance(salary, dict):
        raise ValueError('salary must be an object')
    lower, upper = salary.get('min'), salary.get('max', salary.get('min'))
    for value in (lower, upper):
        if value is not None and (type(value) not in (float, int) or not math.isfinite(value) or value < 0):
            raise ValueError('Salary must be a finite nonnegative number')
    if lower is not None and upper is not None and lower > upper:
        raise ValueError('Salary min exceeds max')
    period = salary.get('period')
    multiplier = {'year': 1/12, 'month': 1}.get(period)
    if period == 'hour':
        hours = salary.get('paid_hours_per_month')
        if type(hours) in (int, float) and math.isfinite(hours) and hours > 0:
            multiplier = hours
        else:
            flags.append('hourly rate needs explicit paid hours per month')
    monthly = None
    if salary.get('currency') == 'USD' and multiplier is not None and lower is not None and upper is not None:
        monthly = [round(lower * multiplier, 2), round(upper * multiplier, 2)]
        if not evidence.get('salary') or salary.get('kind') not in ('listed', 'confirmed'):
            flags.append('salary is estimated or unverified')
        elif upper * multiplier < floor:
            fail.append('salary maximum below floor')
        elif lower * multiplier < floor:
            flags.append('salary range overlaps floor')
    else:
        flags.append('comparable USD base salary unknown')
    return {'verdict': 'FAIL' if fail else 'FLAG' if flags else 'PASS',
            'failures': fail, 'clarifications': flags, 'monthly_usd_range': monthly,
            'floor_monthly_usd': floor}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(classify(json.loads(args.file.read_text(encoding='utf-8'))), indent=2))
    except (ValueError, TypeError, OSError) as exc:
        parser.exit(1, f'Invalid posting facts: {exc}\n')

if __name__ == '__main__':
    main()
