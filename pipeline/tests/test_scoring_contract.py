import json
from pathlib import Path

import numpy as np
import pytest

from dancify_pipeline.scoring_contract import scorable_pose
from dancify_pipeline.schema_io import validate_dance
from test_schema_io import _document

FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'
CASES = json.loads((FIXTURES / 'scorable-targets.json').read_text())['cases']


@pytest.mark.parametrize('case', CASES, ids=lambda c: c['name'])
def test_target_acceptance_matches_browser_contract(case):
    golden = json.loads((FIXTURES / 'pose-normalization.json').read_text())['cases'][0]
    pose = [golden['expected_default'][:] for _ in range(33)]
    for index, value in {**golden['expected_overrides'], **case['overrides']}.items():
        pose[int(index)] = value
    assert scorable_pose(pose) == case['expected']
    if case['expected']:
        validate_dance(_document(np.asarray(pose)))
    else:
        with pytest.raises(ValueError, match='full-body'):
            validate_dance(_document(np.asarray(pose)))
