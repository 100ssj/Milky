"""Configure/check this repository's Pages using Git's existing credential helper.

No credentials are printed or written to disk.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

credentials = subprocess.run(
    ['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
    text=True, capture_output=True, check=True,
).stdout
fields = dict(line.split('=', 1) for line in credentials.splitlines() if '=' in line)
token = fields.get('password')
if not token:
    raise SystemExit('GitHub authentication is unavailable.')

def request(method, suffix, payload=None):
    req = urllib.request.Request(
        'https://api.github.com/repos/100ssj/Milky/' + suffix,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Milky-Pages-Setup'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.load(response) if response.status != 204 else {}
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

status, result = request('GET', 'pages')
if '--configure' in sys.argv:
    payload = {'source': {'branch': 'main', 'path': '/docs'}, 'build_type': 'legacy'}
    status, result = request('POST' if status == 404 else 'PUT', 'pages', payload)
print(json.dumps({'status': status, 'url': result.get('html_url'),
                  'build_status': result.get('status'), 'source': result.get('source'),
                  'message': result.get('message')}, ensure_ascii=False))
if '--build' in sys.argv:
    status, result = request('GET', 'pages/builds/latest')
    print(json.dumps({'status': status, 'build_status': result.get('status'),
                      'error': result.get('error'), 'commit': result.get('commit')}, ensure_ascii=False))
