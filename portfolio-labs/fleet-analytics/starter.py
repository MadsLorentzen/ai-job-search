"""Synthetic fleet-event contract and deterministic fixture. No employer data."""
import argparse
import json
import math
from datetime import datetime
from pathlib import Path


def validate(row):
    errors = []
    for key in ('event_id', 'vehicle_id'):
        if not isinstance(row.get(key), str) or not row[key].strip():
            errors.append(key)
    for key in ('event_time', 'ingested_at'):
        try:
            value = datetime.fromisoformat(row[key])
            if value.utcoffset() is None:
                raise ValueError('timezone required')
        except (KeyError, TypeError, ValueError):
            errors.append(key)
    for key in ('distance_km', 'energy_kwh'):
        value = row.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            errors.append(key)
    return errors


def fixture():
    base = dict(event_id='evt-001', vehicle_id='synthetic-bus-01',
                event_time='2026-01-01T12:00:00+00:00',
                ingested_at='2026-01-01T12:05:00+00:00', distance_km=10, energy_kwh=12)
    return [base, dict(base),
            dict(base, event_id='evt-002', ingested_at='2026-01-03T12:00:00+00:00'),
            dict(base, vehicle_id='', distance_km=-1)]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # Exclusive creation protects an existing dataset from accidental replacement.
    with args.output.open('x') as stream:
        for row in fixture():
            stream.write(json.dumps(row) + '\n')
    print('Wrote 4 synthetic rows: original, duplicate, late event, invalid event.')
