"""Release source policy against disposable local Git repositories; no publication."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/release-ci.py'
spec = importlib.util.spec_from_file_location('release_tags_ci', SCRIPT)
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class ReleaseTags(unittest.TestCase):
    def git(self, *args):
        command = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
                   '-c', 'tag.gpgsign=false', '-c', 'user.name=Synthetic release test',
                   '-c', 'user.email=release-test@example.invalid', *map(str, args)]
        return subprocess.run(command, cwd=self.root, text=True, capture_output=True, check=True).stdout.strip()

    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='athlete-panel-release-tags-')
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name) / 'checkout'; self.root.mkdir()
        self.remote = Path(folder.name) / 'origin.git'
        self.git('init', '--bare', '-q', self.remote)
        self.git('init', '-q', '-b', 'main')
        self.git('commit', '--allow-empty', '-qm', 'Synthetic main')
        self.main = self.git('rev-parse', 'HEAD')
        self.git('remote', 'add', 'origin', self.remote)
        self.git('push', '-q', '-u', 'origin', 'main')
        self.git('tag', '-a', 'v1.0.0', '-m', 'Synthetic stable')
        self.git('checkout', '-qb', 'feature')
        self.git('commit', '--allow-empty', '-qm', 'Synthetic feature')
        self.feature = self.git('rev-parse', 'HEAD')
        self.git('tag', 'v1.1.0')
        self.git('tag', 'v1.1.0-beta.1')
        self.git('tag', 'v1.1.0-rc.1')
        self.enterContext(patch.object(ci, 'ROOT', self.root))

    def test_stable_tag_on_main_supports_annotated_tags_and_branch_name_collision(self):
        self.git('branch', 'v1.0.0', self.feature)
        self.assertFalse(ci.verify_release_tag('v1.0.0', self.main, '1.0.0'))

    def test_stable_feature_tag_is_rejected_even_if_tracking_ref_says_main(self):
        self.git('update-ref', 'refs/remotes/origin/main', self.feature)
        with self.assertRaisesRegex(ValueError, 'Stable releases must reference a commit on origin/main'):
            ci.verify_release_tag('v1.1.0', self.feature, '1.1.0')
        self.assertEqual(self.git('rev-parse', 'refs/remotes/origin/main'), self.main)

    def test_stable_release_fetches_new_main_before_deciding(self):
        self.git('push', '-q', 'origin', 'feature:main')
        self.git('update-ref', 'refs/remotes/origin/main', self.main)
        self.assertFalse(ci.verify_release_tag('v1.1.0', self.feature, '1.1.0'))
        self.assertEqual(self.git('rev-parse', 'refs/remotes/origin/main'), self.feature)
        # A released ancestor remains valid after main advances, including a retry.
        self.assertFalse(ci.verify_release_tag('v1.0.0', self.main, '1.0.0'))

    def test_beta_and_rc_can_publish_from_feature_without_fetching_main(self):
        self.git('remote', 'set-url', 'origin', self.root / 'missing-origin')
        for version in ['1.1.0-beta.1', '1.1.0-rc.1']:
            with self.subTest(version=version):
                self.assertTrue(ci.verify_release_tag('v' + version, self.feature, version))

    def test_failed_fetch_cannot_authorize_stable_from_a_cached_main(self):
        self.git('remote', 'set-url', 'origin', self.root / 'missing-origin')
        with self.assertRaisesRegex(ValueError, 'git fetch failed') as result:
            ci.verify_release_tag('v1.0.0', self.main, '1.0.0')
        self.assertNotIn(str(self.root), str(result.exception))

    def test_changed_tag_and_mismatched_or_invalid_versions_are_rejected(self):
        for tag, commit, version, error in [
            ('v1.1.0-beta.1', self.main, '1.1.0-beta.1', 'verified commit'),
            ('v1.1.0-beta.1', self.feature, '1.1.0-beta.2', 'package version'),
            ('v1.1', self.feature, '1.1', 'package version'),
            ('v1.1.0-beta/1', self.feature, '1.1.0-beta/1', 'package version'),
        ]:
            with self.subTest(tag=tag, version=version), self.assertRaisesRegex(ValueError, error):
                ci.verify_release_tag(tag, commit, version)

    def test_missing_main_ref_is_not_authorized_by_stale_tracking_ref(self):
        self.git('--git-dir', self.remote, 'update-ref', '-d', 'refs/heads/main')
        with self.assertRaisesRegex(ValueError, 'git fetch failed'):
            ci.verify_release_tag('v1.0.0', self.main, '1.0.0')

    def test_git_ancestry_error_is_sanitized_and_blocks_publication(self):
        execute = subprocess.run
        def fail_ancestry(command, **kwargs):
            if command[:2] == ['git', 'merge-base']:
                return subprocess.CompletedProcess(command, 128, '', 'private repository diagnostic')
            return execute(command, **kwargs)
        with patch.object(ci.subprocess, 'run', side_effect=fail_ancestry):
            with self.assertRaisesRegex(ValueError, 'git merge-base failed.*exit 128') as result:
                ci.verify_release_tag('v1.0.0', self.main, '1.0.0')
        self.assertNotIn('private repository diagnostic', str(result.exception))


if __name__ == '__main__': unittest.main()
