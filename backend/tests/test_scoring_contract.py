import json
from pathlib import Path

import pytest

from app.chart_validation import ChartValidationError, validate_chart
from app.report_validation import ReportValidationError, validate_report
from test_api import chart, ready_song, upload_bundle, valid_report

FIXTURES = Path(__file__).resolve().parents[2] / 'pipeline' / 'fixtures'
CASES = json.loads((FIXTURES / 'scorable-targets.json').read_text())['cases']


@pytest.mark.parametrize('case', CASES, ids=lambda c: c['name'])
def test_target_acceptance_matches_browser_contract(case):
    golden = json.loads((FIXTURES / 'pose-normalization.json').read_text())['cases'][0]
    pose = [golden['expected_default'][:] for _ in range(33)]
    for index, value in {**golden['expected_overrides'], **case['overrides']}.items():
        pose[int(index)] = value
    document = chart()
    document['moves'][0]['keyframe_landmarks'] = pose
    if case['expected']:
        validate_chart(json.dumps(document).encode())
    else:
        with pytest.raises(ChartValidationError, match='12 visible'):
            validate_chart(json.dumps(document).encode())


def test_partial_replacement_preserves_published_bundle_and_history(client):
    song = ready_song(client)
    plays_url = f"/songs/{song['id']}/plays"
    saved = client.post(plays_url, json={"bundle_id": song['active_bundle_id'], "score": 700, "mode": "camera"})
    assert saved.status_code == 201
    history = client.get(plays_url).json()
    old = client.get(f"/songs/{song['id']}").json()
    document = chart()
    document['moves'][0]['keyframe_landmarks'][15][3] = 0.1
    response = upload_bundle(client, song['id'], payload=document)
    assert response.status_code == 422
    current = client.get(f"/songs/{song['id']}").json()
    assert current['status'] == 'ready'
    assert current['active_bundle_id'] == old['active_bundle_id']
    assert current['play_count'] == old['play_count'] == 1
    assert client.get(plays_url).json() == history


def test_checkpoint_omission_counts_must_match_chart():
    document = chart()
    report = valid_report(document)
    report['checkpoint_quality'] = {'selected': 3, 'retained': 1, 'omitted': 2}
    validate_report(report, document)
    report['checkpoint_quality']['omitted'] = 0
    with pytest.raises(ReportValidationError, match='counts'):
        validate_report(report, document)
