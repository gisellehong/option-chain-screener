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
