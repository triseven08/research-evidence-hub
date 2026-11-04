import json
import asyncio
import csv
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "eval/livemcpbench"))
from common import initial_rows, load_env, parse_verdict, read_json, report, summary, write_json, validate_task_ids
from protocol import MODELS, PAPER_MODELS, EXCLUDED_MODELS, JUDGES, SCOPE, matrix, model_template, restore_originals, validate_models
from analyze import analyze, exact_mcnemar
from run import Suite, command, fixture_links
from worker import connect_copilot, copilot_environment, validate_judgment


class BenchmarkTests(unittest.TestCase):
    def test_partial_matrix_excludes_unavailable_calls(self):
        jobs = matrix()
        self.assertEqual(len(jobs), 32)
        self.assertEqual(sum(j['kind'] == 'generate' for j in jobs), 9)
        self.assertEqual(len({j['id'] for j in jobs}), 32)
        self.assertEqual(len(MODELS), 9)
        self.assertEqual(len(PAPER_MODELS), 12)
        self.assertEqual(len(JUDGES), 7)
        self.assertFalse(set(MODELS) & set(EXCLUDED_MODELS))
        self.assertEqual(sum(j.get('auto_key_points', False) for j in jobs), 7)
        self.assertEqual({j['embedding'] for j in jobs if j['kind'] == 'generate'}, {'qwen'})
        for j in jobs:
            self.assertNotIn(j.get('model'), EXCLUDED_MODELS)
            self.assertNotIn(j['judge'], EXCLUDED_MODELS)
            self.assertIn(j['judge'], MODELS)
            if j.get('source') and j['source'] != 'published-sonnet':
                self.assertIn(j['source'], {k['id'] for k in jobs[:jobs.index(j)]})

    def test_model_map_cannot_substitute_or_omit_models(self):
        models = model_template()
        self.assertTrue(validate_models(models, {}))
        env = {}
        for key, model in models.items():
            model.update(allowed_response_models=[key], version_evidence='checked', provider_evidence='checked')
            env[model['base_url_env']] = 'http://localhost/v1'
            env[model['api_key_env']] = 'test'
        self.assertEqual(validate_models(models, env), [])
        omitted = dict(models)
        omitted.pop('gemini')
        self.assertTrue(validate_models(omitted, env))
        extra = {**models, 'sonnet4': {}}
        self.assertTrue(validate_models(extra, env))
        models['qwen72']['paper_model'] = 'small replacement'
        self.assertTrue(validate_models(models, env))

    def test_full_denominator_and_null_scored_rate(self):
        rows = initial_rows([{'task_id': str(i), 'category': 'test'} for i in range(95)])
        self.assertIsNone(summary(rows)['scored_success_rate'])
        rows[0]['status'] = 'succeeded'
        rows[1]['status'] = 'failed'
        rows[2]['status'] = 'infra_error'
        rows[3]['status'] = 'judge_error'
        result = summary(rows)
        self.assertEqual(result['planned_success_rate'], 1 / 95)
        self.assertEqual(result['scored_success_rate'], .5)
        self.assertEqual(result['coverage'], 2 / 95)
        self.assertEqual(sum(v for k,v in result['counts'].items() if k != 'planned'), 95)
        with self.assertRaises(ValueError):
            summary(rows + rows[:1])

    def test_strict_judge_parse(self):
        self.assertEqual(parse_verdict('Thoughts: checked\nStatus: "success"'), 'success')
        for text in ['unsuccessful', 'Status: maybe success', 'Status: success\nStatus: failure']:
            with self.assertRaises(ValueError):
                parse_verdict(text)

    def test_environment_does_not_execute_shell(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'env'
            path.write_text('MODEL_ID="$(touch /tmp/should-not-execute)"\nKEY=literal$HOME\n')
            self.assertEqual(load_env(path)['MODEL_ID'], '$(touch /tmp/should-not-execute)')
            self.assertEqual(load_env(path)['KEY'], 'literal$HOME')

    def test_watchdog_terminates_child_process_group(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            marker = root/'orphan'
            child = f'import time,pathlib; time.sleep(1); pathlib.Path({str(marker)!r}).write_text("bad")'
            parent = f'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",{child!r}]); time.sleep(10)'
            self.assertEqual(command([sys.executable, '-c', parent], root/'log', timeout=.1), 124)
            # Observe past the child's scheduled write without a live expensive process.
            import time
            time.sleep(1.1)
            self.assertFalse(marker.exists())

    def test_fixture_collision_and_owned_switch(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            src, home, owned = root/'src', root/'home', root/'owned'
            (src/'csv').mkdir(parents=True)
            (src/'csv/a.csv').write_text('original')
            home.mkdir()
            (home/'csv').mkdir()
            with self.assertRaises(ValueError):
                fixture_links(src, owned/'first', owned, home)
            (home/'csv').rmdir()
            fixture_links(src, owned/'first', owned, home)
            (home/'csv/a.csv').write_text('changed')
            fixture_links(src, owned/'second', owned, home)
            self.assertEqual((home/'csv/a.csv').read_text(), 'original')
            self.assertEqual((owned/'first/csv/a.csv').read_text(), 'changed')

    def test_paired_test_known_result(self):
        a = {str(i): 1 for i in range(10)}
        b = {str(i): int(i >= 6) for i in range(10)}
        self.assertEqual(exact_mcnemar(a,b)['p_value'], .03125)
        self.assertEqual(exact_mcnemar(a,a)['p_value'], 1)
        with self.assertRaises(ValueError):
            exact_mcnemar(a, {'other': 1})

    def test_missing_jobs_cannot_be_reported_complete(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_json(root/'task_ids.json', [str(i) for i in range(95)])
            result = analyze(root)
            self.assertFalse(result['complete'])
            self.assertEqual(sum(e.startswith('Missing ') for e in result['incomplete_jobs']), 32)
            self.assertIn('Incomplete published human labels', result['incomplete_jobs'])
            self.assertTrue(result['manual_evidence_missing'])
            self.assertFalse(result['scope_complete'])
            self.assertFalse(result['full_paper_complete'])
            self.assertEqual({m['id'] for m in result['excluded_models']}, set(EXCLUDED_MODELS))
            self.assertFalse((root/'manual-claude-labels.csv').exists())

    def test_completed_subset_never_claims_complete_paper(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ids = [str(i) for i in range(95)]
            write_json(root/'task_ids.json', ids)
            write_json(root/'matrix.json', matrix())
            write_json(root/'evidence.json', {'fixture': True})
            rows = [{'task_id': i, 'status': 'succeeded', 'trace_path': 'evidence.json',
                     'scoring_evidence': 'evidence.json'} for i in ids]
            for index, job in enumerate(matrix()):
                varied = [{**row, 'status': 'failed' if int(row['task_id']) < index else 'succeeded'} for row in rows]
                write_json(root/job['id']/'tasks.json', varied)
            for i in ids:
                write_json(root/'published-sonnet'/i/'trajectory.json', [{'task_id': i, 'task_success': 'success'}])
            tau = Mock(return_value=SimpleNamespace(statistic=1.0, pvalue=0.0))
            with patch('analyze.behavior', return_value={}), patch.dict(sys.modules, {'scipy.stats': SimpleNamespace(kendalltau=tau)}):
                first = analyze(root)
                self.assertTrue(first['automatic_stages_complete'])
                self.assertFalse(first['scope_complete'])
                review = read_json(root/'reproduction-review.json')
                self.assertNotIn('fresh_claude_human_analysis', review['evidence'])
                review.update(reviewer='fixture', reviewed_at='2026-11-03')
                review['evidence'] = dict.fromkeys(review['evidence'], 'evidence.json')
                write_json(root/'reproduction-review.json', review)
                result = analyze(root)
            self.assertTrue(result['scope_complete'])
            self.assertFalse(result['complete'])
            self.assertFalse(result['full_paper_complete'])
            self.assertEqual(len(tau.call_args.args[0]), 9)
            self.assertEqual(read_json(root/'tables/judge-voting.json')['judge_count'], 7)
            self.assertFalse((root/'tables/table3-retrieval.csv').exists())

    def test_analysis_missing_evidence_labels_and_stale_tables(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ids = [str(i) for i in range(95)]
            write_json(root/'task_ids.json', ids)
            rows = [{'task_id': i, 'status': 'succeeded', 'trace_path': 'missing',
                     'scoring_evidence': 'missing'} for i in ids]
            for job in matrix():
                write_json(root/job['id']/'tasks.json', rows)
            write_json(root/'tables/kendall-tau.json', {'stale': True})
            write_json(root/'tables/judge-voting.json', {'stale': True})
            write_json(root/'published-sonnet/0/trajectory.json', [{'task_id': 'wrong', 'task_success': 'success'}])
            with patch('analyze.behavior', return_value={}):
                status = analyze(root)
            self.assertFalse(status['automatic_stages_complete'])
            with (root/'tables/table2-main.csv').open() as stream:
                table = list(csv.DictReader(stream))
            self.assertTrue(all(r['complete'] == 'False' and r['observed_success_pct'] == '' for r in table))
            self.assertFalse((root/'tables/kendall-tau.json').exists())
            self.assertFalse((root/'tables/judge-voting.json').exists())
            self.assertIn('Incomplete published human labels', status['incomplete_jobs'])

    def test_constant_rankings_export_null_not_nan(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ids = [str(i) for i in range(95)]
            write_json(root/'task_ids.json', ids)
            write_json(root/'evidence.json', {'fixture': True})
            rows = [{'task_id': i, 'status': 'succeeded', 'trace_path': 'evidence.json',
                     'scoring_evidence': 'evidence.json'} for i in ids]
            for job in matrix():
                write_json(root/job['id']/'tasks.json', rows)
            with patch('analyze.behavior', return_value={}):
                analyze(root)
            tau = read_json(root/'tables/kendall-tau.json')
            self.assertIsNone(tau['tau_b'])
            self.assertIsNone(tau['p_value'])
            self.assertFalse(tau['defined'])

    def test_raw_judge_response_cannot_hide_multiple_verdicts(self):
        result = {'judge': '"success"', 'reward': 1}
        self.assertEqual(validate_judgment(result, 'Thoughts: checked\nStatus: "success"'), 'success')
        for raw in ('Status: success\nStatus: failure', 'Status: success or failure', 'Status: failure'):
            with self.assertRaises(ValueError):
                validate_judgment(result, raw)

    def test_copilot_environment_forwarded_without_provider_keys(self):
        env = {'PATH': '/bin', 'HOME': '/tmp', 'PYTHONPATH': '/work', 'TOP_TOOLS': '5',
               'EMBEDDING_BASE_URL': 'http://127.0.0.1:18001/v1', 'EMBEDDING_API_KEY': 'local',
               'EMBEDDING_DIMENSIONS': '1024', 'MCP_DATA_PATH': '/work/index.json',
               'OPENAI_API_KEY': 'must-not-inherit', 'OPENROUTER_API_KEY': 'must-not-inherit'}
        captured = {}
        client = SimpleNamespace(sessions={})
        async def config_connect(config):
            captured.update(config['mcpServers']['mcp-copilot'])
            client.sessions['mcp-copilot'] = object()
        client.config_connect = config_connect
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(connect_copilot(client))
        self.assertEqual(captured['command'], sys.executable)
        self.assertEqual(captured['env'], copilot_environment(env))
        self.assertEqual(captured['env']['TOP_TOOLS'], '5')
        self.assertNotIn('OPENAI_API_KEY', captured['env'])
        self.assertNotIn('OPENROUTER_API_KEY', captured['env'])

    def test_failed_copilot_connection_is_not_a_generation(self):
        async def config_connect(config):
            pass
        client = SimpleNamespace(sessions={}, config_connect=config_connect)
        with self.assertRaisesRegex(RuntimeError, 'failed to initialize'):
            asyncio.run(connect_copilot(client))

    def test_task_ids_and_resume_order_fail_closed(self):
        valid = [str(i) for i in range(95)]
        self.assertEqual(validate_task_ids(valid), valid)
        for ids in (valid[:94], valid[:94] + ['0'], valid[:94] + ['../escape']):
            with self.assertRaises(ValueError):
                validate_task_ids(ids)
        with tempfile.TemporaryDirectory() as temp:
            suite = Suite.__new__(Suite)
            suite.run = Path(temp)
            suite.tasks = [{'task_id':'a'}, {'task_id':'b'}]
            write_json(suite.run/'job/tasks.json', [{'task_id':'b'}, {'task_id':'a'}])
            with self.assertRaisesRegex(ValueError, 'task order/coverage'):
                suite.run_job({'id':'job', 'kind':'generate'})

    def test_old_run_matrix_cannot_be_reinterpreted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_json(root/'matrix.json', matrix() + [{'id':'main-sonnet4'}])
            with self.assertRaisesRegex(ValueError, 'matrix differs'):
                analyze(root)

    def test_init_prunes_old_config_and_preserves_retained_settings(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            models = {**model_template(), **{key: {'old': True} for key in EXCLUDED_MODELS}}
            models['qwen72']['request_model'] = 'existing-verified-endpoint'
            write_json(root/'models.json', models)
            (root/'env').write_text('OPENROUTER_API_KEY=preserved\n')
            argv = [sys.executable, str(Path(__file__).resolve().parents[1]/'eval/livemcpbench/run.py'),
                    'init', '--env-file', str(root/'env'), '--models', str(root/'models.json')]
            for _ in range(2):
                subprocess.run(argv, check=True, capture_output=True)
            saved = read_json(root/'models.json')
            self.assertEqual(set(saved), set(MODELS))
            self.assertEqual(saved['qwen72'], models['qwen72'])
            self.assertEqual((root/'env').read_text(), 'OPENROUTER_API_KEY=preserved\n')

    def test_cli_plan_has_no_removed_api_or_bge_requirement(self):
        launcher = Path(__file__).resolve().parents[1]/'eval/livemcpbench/run.py'
        plan = json.loads(subprocess.check_output([sys.executable, str(launcher), 'plan'], text=True))
        self.assertEqual(plan['scope'], SCOPE)
        self.assertEqual(plan['total_generation_tasks'], 855)
        self.assertEqual(plan['minimum_judge_calls'], 3040)
        self.assertEqual(plan['additional_auto_keypoint_calls'], 665)
        self.assertFalse(plan['full_paper_complete'])
        self.assertEqual({m['base_url_env'] for m in model_template().values()}, {'OPENROUTER_BASE_URL'})
        from run import check
        errors = check({'QWEN_EMBEDDING_REVISION': 'a'*40}, {})
        self.assertFalse(any('BGE' in error for error in errors))

    def test_atomic_report_keeps_all_planned_tasks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            rows = initial_rows([{'task_id':'a','category':'Office'}, {'task_id':'b','category':'Travel'}])
            rows[0].update(status='infra_error',error_type='interrupted')
            report(root, rows)
            self.assertEqual(read_json(root/'tasks.json'), rows)
            self.assertEqual(read_json(root/'summary.json')['counts']['not_run'], 1)
            self.assertFalse(list(root.glob('*.tmp')))

    def test_job_preserves_failures_and_resume_does_not_retry(self):
        with tempfile.TemporaryDirectory() as temp:
            suite = Suite.__new__(Suite)
            suite.run = Path(temp)
            suite.tasks = [{'task_id': 'a', 'category': 'Office', 'Question': 'a'},
                           {'task_id': 'b', 'category': 'Office', 'Question': 'b'}]
            suite.env = {'TASK_TIMEOUT':'1', 'JUDGE_TIMEOUT':'1'}
            suite.model_env = lambda key: {}
            suite.identity_ok = lambda key, names: names == ['expected']
            suite.fixtures = lambda job: None
            job = {'id':'main-test','kind':'generate','model':'test','judge':'v3','top_tools':5}
            directory = suite.run/job['id']
            report(directory, initial_rows(suite.tasks))
            calls = []
            def fake_worker(mode, output, extra=(), env=None, timeout=1):
                calls.append((mode,output.name))
                if mode == 'generate':
                    if output.name == 'b':
                        return 124
                    write_json(output/'generation.json', {'status':'generated','returned_models':['expected']})
                    write_json(output/'trajectory.json', [{'task_id':'a','messages':[]}])
                else:
                    write_json(output/'judge.json', {})
                    write_json(output/'judgment.json', {'status':'failed','score':0,'error_type':None,
                        'usage':[{'model':'expected'}], 'scoring_evidence':'judge.json'})
                return 0
            suite.worker = fake_worker
            suite.run_job(job)
            rows = read_json(directory/'tasks.json')
            self.assertEqual([r['status'] for r in rows], ['failed','infra_error'])
            self.assertEqual(rows[1]['error_type'],'task_timeout')
            self.assertEqual(summary(rows)['scored_success_rate'],0)
            before = list(calls)
            suite.run_job(job)
            self.assertEqual(calls,before)

    def test_wrong_generation_identity_is_not_judged(self):
        with tempfile.TemporaryDirectory() as temp:
            suite = Suite.__new__(Suite)
            suite.run = Path(temp)
            suite.tasks = [{'task_id':'a','category':'Office','Question':'a'}]
            suite.env = {'TASK_TIMEOUT':'1','JUDGE_TIMEOUT':'1'}
            suite.model_env = lambda key: {}
            suite.identity_ok = lambda key, names: False
            suite.fixtures = lambda job: None
            report(suite.run/'main-test', initial_rows(suite.tasks))
            def fake_worker(mode, output, *args):
                self.assertEqual(mode,'generate')
                write_json(output/'generation.json',{'status':'generated','returned_models':['wrong']})
                return 0
            suite.worker = fake_worker
            suite.run_job({'id':'main-test','kind':'generate','model':'test','judge':'v3','top_tools':5})
            self.assertEqual(read_json(suite.run/'main-test/tasks.json')[0]['error_type'],'model_api_or_identity_error')

    @unittest.skipUnless(os.environ.get('LIVEMCPBENCH_TEST_UPSTREAM'), 'optional pinned-source integration test')
    def test_original_snapshot_restores_paper_inventory(self):
        source = Path(os.environ['LIVEMCPBENCH_TEST_UPSTREAM'])
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            files = ['baseline/mcp_copilot/config/original_clean_config.json',
                     'baseline/mcp_copilot/config/original_mcp_arg_Qwen3-Embedding-0.6B_qwen25_72b_int4_instruct copy.json',
                     'tools/LiveMCPTool/original_tools.json', 'baseline/mcp_copilot/server.py']
            for file in files:
                (root/file).parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(source/file,root/file)
            result = restore_originals(root)
            self.assertEqual((result['servers'],result['tools']), (70,527))
            index = read_json(root/'baseline/mcp_copilot/config/paper-index.json')
            self.assertEqual(sum(len(s['tools']) for s in index), 527)
            self.assertEqual(result['removed_index_only_aliases'], ['Asset Price MCP'])


if __name__ == '__main__':
    unittest.main()
