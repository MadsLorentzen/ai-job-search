import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from tools.remote_gate import classify
from tools.remote_sources import parse, discover
from tools.create_private_workspace import create


class RemoteMarketTests(unittest.TestCase):
    def job(self):
        return {'remote': True, 'brazil_eligible': True, 'paid_in_usd': True,
                'salary': {'min': 54000, 'max': 72000, 'currency': 'USD', 'period': 'year', 'kind': 'listed'},
                'evidence': {k:'explicit posting evidence' for k in ['remote','brazil_eligible','paid_in_usd','salary']},
                'source_url':'https://example.com/job', 'checked_date':'2026-01-01'}
    def test_confirmed_annual_pay(self):
        result=classify(self.job()); self.assertEqual(result['verdict'],'PASS')
        self.assertEqual(result['monthly_usd_range'],[4500,6000])
    def test_us_remote_is_not_brazil(self):
        j=self.job();j['brazil_eligible']=False
        self.assertEqual(classify(j)['verdict'],'FAIL')
    def test_display_currency_not_payment(self):
        j=self.job();j['paid_in_usd']=None
        self.assertEqual(classify(j)['verdict'],'FLAG')
    def test_salary_overlap_and_estimate(self):
        j=self.job();j['salary']['min']=48000
        self.assertEqual(classify(j)['verdict'],'FLAG')
        j['salary']['max']=50000
        self.assertEqual(classify(j)['verdict'],'FAIL')
        j['salary']['kind']='estimated'
        self.assertEqual(classify(j)['verdict'],'FLAG')
    def test_hourly_needs_hours(self):
        j=self.job();j['salary'].update(min=40,max=50,period='hour')
        self.assertEqual(classify(j)['verdict'],'FLAG')
        j['salary']['paid_hours_per_month']=120
        self.assertEqual(classify(j)['verdict'],'PASS')
    def test_invalid_pay_and_booleans(self):
        j=self.job();j['salary']['min']=float('nan')
        with self.assertRaises(ValueError):classify(j)
        j=self.job();j['remote']='true'
        with self.assertRaises(ValueError):classify(j)
    def test_source_contract(self):
        rows=parse('wwr',b'<rss><channel><item><title>Acme: Data Engineer</title><link>https://example.com/job</link></item></channel></rss>')
        self.assertEqual(rows[0]['title'],'Data Engineer')
        self.assertEqual(rows[0]['eligibility'],'unverified')
        rows=parse('greenhouse',json.dumps({'jobs':[{'id':1,'title':'Data Engineer','absolute_url':'https://example.com/job','updated_at':'today'}]}).encode(),'acme')
        self.assertEqual(rows[0]['date'],'')
        with self.assertRaises(ValueError):discover('lever','../bad')
    def test_private_workspace_preserves_source_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);src=root/'source';src.mkdir()
            subprocess.run(['git','init',str(src)],check=True,capture_output=True)
            (src/'CLAUDE.md').write_text('template')
            subprocess.run(['git','-C',str(src),'add','.'],check=True)
            subprocess.run(['git','-C',str(src),'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture'],check=True,capture_output=True)
            (src/'secret.txt').write_text('untracked secret')
            dest=create(root/'private',src)
            self.assertFalse((dest/'.git').exists());self.assertFalse((dest/'secret.txt').exists())
            self.assertEqual((dest/'.gitignore').read_text(),'*\n')
            with self.assertRaises(ValueError):create(dest,src)
            with self.assertRaises(ValueError):create(src/'nested',src)
