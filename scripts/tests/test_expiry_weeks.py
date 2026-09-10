import importlib.util
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('fetcher', Path(__file__).parents[1] / 'fetch-moomoo-data.py')
fetcher = importlib.util.module_from_spec(spec)
with patch.dict('sys.modules', {'moomoo': SimpleNamespace(AuType=None, KLType=None, OpenQuoteContext=None, RET_OK=0)}):
    spec.loader.exec_module(fetcher)

class ExpiryWeekTests(unittest.TestCase):
    def dates(self, today, dates):
        with patch.object(fetcher, 'market_today', return_value=date.fromisoformat(today)), patch.object(fetcher, 'expiration_dates', return_value=dates):
            return fetcher.friday_expiration_dates(None, 'US.SOXL')

    def test_current_week_and_five_future_weeks(self):
        dates = ['2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16']
        self.assertEqual(self.dates('2026-09-10', list(reversed(dates)) + ['2026-10-23']), dates)

    def test_weekend_does_not_extend_fifth_week(self):
        dates = ['2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23']
        self.assertEqual(self.dates('2026-09-12', dates), dates[1:6])

    def test_friday_keeps_current_expiry(self):
        self.assertEqual(self.dates('2026-09-11', ['2026-09-11']), ['2026-09-11'])
