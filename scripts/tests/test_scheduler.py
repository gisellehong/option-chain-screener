import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('snapshot', Path(__file__).parents[1] / 'run-scheduled-snapshot.py')
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)

class SignalTests(unittest.TestCase):
    def signal(self, strategy='soxl_csp', at='2026-09-04T13:30:00+00:00'):
        return snapshot.compact_signal({'id':'SOXL260911P70000','ticker':'SOXL','optionType':'put','expiration':'2026-09-11','bid':1,'ask':1.2,'mid':1.1,'strike':70,'underlyingPrice':100},strategy,'half_hourly',at,1)
    def quote(self, ask):
        return {'bid':max(0,(ask or 0)-0.01),'ask':ask,'underlyingPrice':100}
    def test_bid_entry_capture_milestones_and_drawdown(self):
        s=self.signal()
        snapshot.update_signal_outcome(s,self.quote(2),'2026-09-04T14:00:00+00:00')
        self.assertEqual(s['outcome']['worstProfitCapturePct'],-100)
        for ask,hour in [(0.5,15),(0.3,16),(0.2,17)]:
            snapshot.update_signal_outcome(s,self.quote(ask),f'2026-09-04T{hour}:00:00+00:00')
        for pct in [50,70,80]:self.assertIsNotNone(s['outcome'][f'hit{pct}At'])
        self.assertEqual(s['outcome']['bestProfitCapturePct'],80)
        self.assertTrue(s['outcome']['hit80Within5D'])
    def test_invalid_quotes_do_not_create_profit(self):
        for ask in [None,0,-1,float('nan')]:
            s=self.signal();snapshot.update_signal_outcome(s,self.quote(ask),'2026-09-04T14:00:00+00:00')
            self.assertIsNone(s['outcome']['hit80At']);self.assertEqual(s['observations']['count'],0)
    def test_us_trading_day_dedup_and_version(self):
        a=self.signal(at='2026-09-05T01:00:00+08:00');b=self.signal(at='2026-09-05T03:00:00+08:00')
        self.assertEqual(snapshot.signal_key(a),snapshot.signal_key(b))
        b['strategyVersion']='v2';self.assertNotEqual(snapshot.signal_key(a),snapshot.signal_key(b))
    def test_expiration_uses_new_york_date_not_singapore_midnight(self):
        s=self.signal();snapshot.update_signal_outcome(s,self.quote(1),'2026-09-12T03:00:00+08:00')
        self.assertFalse(s['outcome']['expired'])
        snapshot.update_signal_outcome(s,self.quote(1),'2026-09-12T13:00:00+08:00')
        self.assertTrue(s['outcome']['expired']);self.assertEqual(s['outcome']['settlementStatus'],'unverified')
    def test_legacy_mid_convention_preserved(self):
        s=self.signal('weekly_csp');snapshot.update_signal_outcome(s,self.quote(0.22),'2026-09-04T14:00:00+00:00')
        self.assertIsNotNone(s['outcome']['hit80At'])

if __name__=='__main__':unittest.main()

class QuarterHourTests(unittest.TestCase):
    def test_quarter_hour_slots_preserve_close_and_have_no_duplicates(self):
        from datetime import datetime
        spec=importlib.util.spec_from_file_location('due',Path(__file__).parents[1]/'run-due-snapshot.py')
        due=importlib.util.module_from_spec(spec);spec.loader.exec_module(due)
        times=[item['time'] for item in due.SCHEDULE]
        self.assertEqual(len(times),len(set(times)))
        for minute in range(570,960,15):
            job=due.due_job(datetime(2026,9,11,minute//60,minute%60,tzinfo=due.NY_TZ),10)
            self.assertIsNotNone(job)
        self.assertEqual(due.due_job(datetime(2026,9,11,16,0,tzinfo=due.NY_TZ),10)['session'],'close')
