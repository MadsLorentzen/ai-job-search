import unittest
from starter import fixture, validate


class ContractTests(unittest.TestCase):
    def test_seeded_fault_and_duplicate_are_distinct(self):
        rows = fixture()
        self.assertEqual([validate(x) for x in rows], [[], [], [], ['vehicle_id', 'distance_km']])
        self.assertEqual(rows[0], rows[1])
        self.assertNotEqual(rows[0]['event_id'], rows[2]['event_id'])

    def test_invalid_measurements_and_naive_time(self):
        for value in [True, float('nan'), float('inf'), -1, '12', None]:
            self.assertIn('energy_kwh', validate(dict(fixture()[0], energy_kwh=value)))
        self.assertIn('event_time', validate(dict(fixture()[0], event_time='2026-01-01T12:00:00')))


if __name__ == '__main__':
    unittest.main()
