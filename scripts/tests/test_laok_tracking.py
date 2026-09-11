import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from datetime import date
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('laok_fetcher', Path(__file__).parents[1] / 'fetch-moomoo-data.py')
fetcher = importlib.util.module_from_spec(spec)
with patch.dict('sys.modules', {'moomoo': SimpleNamespace(AuType=None, KLType=None, OpenQuoteContext=None, RET_OK=0)}):
    spec.loader.exec_module(fetcher)

class ComparisonContractTests(unittest.TestCase):
    def test_unexpired_references_and_frozen_picks_are_deduplicated(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            ref=root/'references.json'
            a={'ticker':'NBIS','expiration':'2026-09-25','strike':180,'optionType':'put'}
            b={'ticker':'SOXL','expiration':'2026-09-18','strike':70,'optionType':'put'}
            ref.write_text(json.dumps({'recommendations':[a,a,dict(a,expiration='2026-09-04')]}))
            decisions=root/'decisions'/'2026-09-10';decisions.mkdir(parents=True)
            (decisions/'test.json').write_text(json.dumps({'scenarios':{'execution':[a,b],'conservative':[b]}}))
            with patch.object(fetcher,'market_today',return_value=date(2026,9,11)):
                rows=fetcher.load_comparison_contracts(ref,root/'decisions')
            self.assertEqual(rows,{'US.NBIS':[{'expiration':'2026-09-25','strike':180,'optionType':'put'}],'US.SOXL':[{'expiration':'2026-09-18','strike':70,'optionType':'put'}]})

    def test_broad_scope_bypasses_expiration_cap_and_preserves_tracked_strikes(self):
        rows=[{'code':f'US.TEST{strike}P','strike_price':strike,'option_type':'PUT'} for strike in (39,40,55,100,110,111,130)]
        ctx=SimpleNamespace(get_option_chain=lambda **kwargs:(0,rows))
        audit=[]
        with patch.object(fetcher.time,'sleep'):
            codes=fetcher.collect_chain_codes(ctx,'US.SOXL',['2026-09-18','2026-11-13'],100,1,
                [{'expiration':'2026-11-13','strike':130,'optionType':'put'}],set(),{'2026-11-13'},audit)
        self.assertIn('US.TEST40P',codes)
        self.assertIn('US.TEST110P',codes)
        self.assertIn('US.TEST130P',codes)
        self.assertNotIn('US.TEST39P',codes)
        self.assertNotIn('US.TEST111P',codes)
        self.assertEqual(len(audit),14)

    def test_inventory_cache_reuses_definitions_and_refreshes_at_noon(self):
        from unittest.mock import Mock
        method=Mock(return_value=(0,[{'code':'US.X','strike_price':50,'option_type':'PUT'}]))
        with tempfile.TemporaryDirectory() as directory, patch.object(fetcher.time,'sleep'):
            with patch.object(fetcher,'datetime') as clock:
                clock.now.return_value=SimpleNamespace(date=lambda:date(2026,9,11),hour=9)
                for _ in range(2):
                    fetcher.inventory_call(Path(directory),'get_option_chain',method,code='US.SOXL',start='2026-09-18')
                self.assertEqual(method.call_count,1)
                clock.now.return_value=SimpleNamespace(date=lambda:date(2026,9,11),hour=12)
                fetcher.inventory_call(Path(directory),'get_option_chain',method,code='US.SOXL',start='2026-09-18')
                self.assertEqual(method.call_count,2)

    def test_new_reference_ticker_stays_in_observation_universe_after_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            ref=Path(directory)/'references.json'
            ref.write_text(json.dumps({'recommendations':[{'ticker':'AMD','expiration':'2000-01-01'}]}))
            self.assertEqual(fetcher.comparison_universe(ref),{'US.SOXL','US.NBIS','US.LITE','US.AMD'})

    def test_rate_limit_retries_but_other_errors_fail_immediately(self):
        from unittest.mock import Mock
        method=Mock(side_effect=[(1,'high frequency'),(0,[])])
        with patch.object(fetcher.time,'sleep') as sleep:
            self.assertEqual(fetcher.call_or_raise('chain',method),[])
            sleep.assert_called_once_with(31)
        with patch.object(fetcher.time,'sleep') as sleep:
            with self.assertRaises(RuntimeError):
                fetcher.call_or_raise('chain',lambda:(1,'permission denied'))
            sleep.assert_not_called()
