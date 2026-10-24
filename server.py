"""Local classroom prototype. Python standard library only."""
import argparse
import csv
from contextlib import contextmanager
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'data' / 'classroom.sqlite3'
SESSIONS = {}
KST = timezone(timedelta(hours=9))

def today():
    return datetime.now(KST).date().isoformat()

def now():
    return datetime.now(KST).isoformat(timespec='seconds')

@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        with db:
            yield db
    finally:
        db.close()

def seed():
    DB.parent.mkdir(exist_ok=True)
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS schools(id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL);
        CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY, grade INTEGER, number INTEGER, salt TEXT, pin TEXT, UNIQUE(grade,number));
        CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, day TEXT, grade INTEGER, kind TEXT, title TEXT, passage TEXT, target TEXT, hint TEXT);
        CREATE TABLE IF NOT EXISTS responses(id INTEGER PRIMARY KEY, student INTEGER REFERENCES students(id), task INTEGER REFERENCES tasks(id), answers TEXT, confidence TEXT, created TEXT, updated TEXT, feedback TEXT DEFAULT '', UNIQUE(student,task));
        CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY, response INTEGER REFERENCES responses(id), answers TEXT, confidence TEXT, saved TEXT);
        ''')
    # A backup and transactional table rebuild preserve all existing student IDs and answers.
    with connect() as db:
        columns = {r['name'] for r in db.execute('PRAGMA table_info(students)')}
        if 'school_id' not in columns:
            if db.execute('SELECT COUNT(*) FROM students').fetchone()[0]:
                shutil.copy2(DB, DB.with_name('before-two-schools-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.sqlite3'))
            db.execute('PRAGMA foreign_keys=OFF')
            db.executescript('''BEGIN;
            INSERT OR IGNORE INTO schools(id,name,code) VALUES(3,'기존 체험','FOREST56');
            CREATE TABLE students_new(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), grade INTEGER NOT NULL, classroom INTEGER NOT NULL DEFAULT 1, number INTEGER NOT NULL, salt TEXT, pin TEXT, UNIQUE(school_id,grade,classroom,number));
            INSERT INTO students_new(id,school_id,grade,classroom,number,salt,pin) SELECT id,3,grade,1,number,salt,pin FROM students;
            DROP TABLE students;
            ALTER TABLE students_new RENAME TO students;
            COMMIT;''')
            db.execute('PRAGMA foreign_keys=ON')
        db.execute('INSERT OR IGNORE INTO schools(id,name,code) VALUES(1,?,?)', ('온샘초등학교', os.environ.get('MORNING_ONSAEM_CODE', 'ONSAEM56').upper()))
        db.execute('INSERT OR IGNORE INTO schools(id,name,code) VALUES(2,?,?)', ('동명초등학교', os.environ.get('MORNING_DONGMYEONG_CODE', 'DONGMYEONG56').upper()))
        for name, declaration in [('school_id','INTEGER REFERENCES schools(id)'), ('project',"TEXT NOT NULL DEFAULT 'foundation'"), ('stage',"TEXT NOT NULL DEFAULT 'read'"), ('focus',"TEXT NOT NULL DEFAULT ''"), ('source_note',"TEXT NOT NULL DEFAULT ''")]:
            if name not in {r['name'] for r in db.execute('PRAGMA table_info(tasks)')}:
                db.execute(f'ALTER TABLE tasks ADD COLUMN {name} {declaration}')
        if 'observation' not in {r['name'] for r in db.execute('PRAGMA table_info(responses)')}:
            db.execute("ALTER TABLE responses ADD COLUMN observation TEXT NOT NULL DEFAULT ''")
        if db.execute('SELECT COUNT(*) FROM tasks').fetchone()[0] == 0:
            for grade in (5, 6):
                items = [
                    ('word', '문맥 속 낱말 탐정', '학급 회의에서 축제 부스를 정했다. 민지는 친구들의 의견을 경청한 뒤, 두 의견의 장점을 합친 새로운 방법을 제안했다.', '경청', '앞뒤 행동을 단서로 뜻을 짐작해 보세요. 사전 표현을 외우기보다 내 말로 풀어 써요.'),
                    ('sentence', '두 문장 사이의 다리', '우리 반은 일회용품을 줄이기로 했다.\n축제 준비 시간에는 종이컵이 많이 사용되었다.', '그러나 / 그래서 / 왜냐하면', '대조·결과·이유 중 어떤 관계가 어울릴까요? 필요하다면 문장 일부를 자연스럽게 고쳐도 좋아요.'),
                    ('paragraph', '문단의 중심을 찾아서', '학교 텃밭은 함께 배우는 교실이다.\n우리는 씨앗이 자라는 모습을 관찰하며 식물의 변화를 배운다.\n물을 주는 순서를 정하면서 서로 책임을 나누는 방법도 익힌다.\n수확한 채소를 함께 나누며 배려의 의미도 생각한다.', '', '중심 문장은 나머지 문장들을 아우릅니다. 예시를 하나씩 옮겨 적기보다 공통된 내용을 묶어 요약해 보세요.')
                ]
                if grade == 6:
                    items[0] = ('word', '문맥 속 낱말 탐정', '모둠은 두 제안의 장단점을 검토했다. 시간이 부족한 상황에서 모든 요구를 반영하기는 어려웠지만, 서로 조금씩 양보하며 절충안을 마련했다.', '절충안', '두 제안과 양보라는 단서를 연결해 보세요. 비슷한 상황을 떠올려 뜻을 풀어 써요.')
                    items[2] = ('paragraph', '문단의 중심을 찾아서', '온라인에서 정보를 나누기 전에는 신뢰성을 살펴야 한다.\n조회 수가 높아도 근거가 부족한 정보일 수 있다.\n출처와 작성 시기를 확인하면 정보의 배경을 이해할 수 있다.\n다른 자료와 비교하는 과정도 정보가 타당한지 판단하는 데 도움이 된다.', '', '주장과 근거의 관계를 살펴보세요. 핵심을 요약하고, 글만으로 해결되지 않은 질문도 남겨 보세요.')
                db.executemany('INSERT INTO tasks(day,grade,kind,title,passage,target,hint) VALUES(?,?,?,?,?,?,?)', [(today(), grade, *x) for x in items])

def pin_hash(pin, salt):
    return hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

class Handler(BaseHTTPRequestHandler):
    def send(self, status, payload, mime='application/json; charset=utf-8', cookie=None):
        raw = (json.dumps(payload, ensure_ascii=False).encode() if mime.startswith('application/json') else payload)
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'")
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(raw)

    def session(self):
        c = SimpleCookie(self.headers.get('Cookie', ''))
        token = c.get('session')
        s = SESSIONS.get(token.value) if token else None
        if not s or s['expires'] < datetime.now().timestamp():
            raise PermissionError('다시 입장해 주세요.')
        return s

    def teacher(self):
        s = self.session()
        if s['role'] != 'teacher':
            raise PermissionError('교사 권한이 필요합니다.')
        return s

    def do_GET(self):
        try:
            route = self.path.split('?')[0]
            if not route.startswith('/api/'):
                files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
                files.update({f'/fonts/SCDream{n}.otf': (f'fonts/SCDream{n}.otf', 'font/otf') for n in range(4, 8)})
                files['/fonts/LICENSE.png'] = ('fonts/LICENSE.png', 'image/png')
                if route not in files:
                    return self.send(404, {'error': '찾을 수 없습니다.'})
                file, mime = files[route]
                return self.send(200, (ROOT / 'public' / file).read_bytes(), mime)
            if route == '/api/me':
                return self.send(200, self.session())
            s = self.session()
            with connect() as db:
                if route == '/api/context':
                    self.teacher()
                    return self.send(200, {'schools': [dict(r) for r in db.execute('SELECT id,name,code FROM schools ORDER BY id')]})
                if route == '/api/tasks':
                    rows = db.execute('SELECT id,day,grade,kind,title,passage,target,hint,school_id,source_note FROM tasks ORDER BY day DESC,id DESC' if s['role'] == 'teacher' else 'SELECT id,day,grade,kind,title,passage,target,hint,school_id,source_note FROM tasks WHERE grade=? AND day<=? AND (school_id IS NULL OR school_id=?) ORDER BY day DESC,id', () if s['role'] == 'teacher' else (s['grade'], today(), s['school_id'])).fetchall()
                    return self.send(200, [dict(r) for r in rows])
                if route in ('/api/responses', '/api/export', '/api/export-history'):
                    if route != '/api/responses':
                        self.teacher()
                    q = '''SELECT r.*,s.grade,s.classroom,s.number,s.school_id,sc.name AS school_name,t.kind,t.title,t.day,t.passage,t.target,t.hint,t.source_note FROM responses r JOIN students s ON s.id=r.student JOIN schools sc ON sc.id=s.school_id JOIN tasks t ON t.id=r.task'''
                    conditions, params = [], []
                    if s['role'] == 'student':
                        conditions.append('r.student=?')
                        params.append(s['student'])
                    if route != '/api/responses':
                        filters = parse_qs(urlsplit(self.path).query)
                        for key, column in [('school', 's.school_id'), ('grade', 's.grade'), ('classroom', 's.classroom'), ('number', 's.number'), ('kind', 't.kind'), ('day', 't.day')]:
                            value = filters.get(key, [''])[0]
                            if value:
                                conditions.append(column + '=?')
                                params.append(value)
                    rows = db.execute(q + (' WHERE ' + ' AND '.join(conditions) if conditions else '') + ' ORDER BY r.updated DESC,r.id DESC', params).fetchall()
                    result = [dict(r) for r in rows]
                    for r in result:
                        if s['role'] == 'student':
                            r.pop('observation', None)
                        r['answers'] = json.loads(r['answers'])
                        r['revisions'] = [dict(v) for v in db.execute('SELECT answers,confidence,saved FROM revisions WHERE response=? ORDER BY id', (r['id'],))]
                        for v in r['revisions']:
                            v['answers'] = json.loads(v['answers'])
                    if route == '/api/responses':
                        return self.send(200, result)
                    out = io.StringIO(newline='')
                    w = csv.writer(out)
                    w.writerow(['학생ID', '학교', '학년', '반', '번호', '활동ID', '활동일', '영역', '활동', '자료 출처 메모', '지문', '핵심 낱말/접속 표현', '짐작한 뜻', '문맥 단서', '활용 문장', '연결한 문장', '표현 선택 이유', '중심 문장', '요약', '질문', '자기점검(일상 활동)', '현재 교사 피드백', '현재 교사 관찰', '최초제출', '저장시각', '저장차례', '총저장횟수'])
                    def safe(v):
                        v = str(v)
                        return "'" + v if v.lstrip().startswith(('=', '+', '-', '@')) else v
                    for r in result:
                        snapshots = r['revisions'] if route == '/api/export-history' else [{'answers':r['answers'], 'confidence':r['confidence'], 'saved':r['updated']}]
                        for index, v in enumerate(snapshots, 1):
                            w.writerow([safe(x) for x in [r['student'], r['school_name'], r['grade'], r['classroom'], r['number'], r['task'], r['day'], {'word':'어휘','sentence':'문장','paragraph':'문단'}[r['kind']], r['title'], r['source_note'], r['passage'], r['target'], *(v['answers'].get(k,'') for k in ('meaning','clue','example','sentence','reason','central','summary','question')), v['confidence'], r['feedback'], r['observation'], r['created'], v['saved'], index if route == '/api/export-history' else len(r['revisions']), len(r['revisions'])]])
                    return self.send(200, ('\ufeff' + out.getvalue()).encode(), 'text/csv; charset=utf-8')
            self.send(404, {'error': '찾을 수 없습니다.'})
        except PermissionError as e:
            self.send(401, {'error': str(e)})

    def do_POST(self):
        try:
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + self.headers.get('Host', ''):
                raise PermissionError('허용되지 않은 요청입니다.')
            length = int(self.headers.get('Content-Length', '0'))
            if length < 1 or length > 40000:
                raise ValueError('요청 크기를 확인해 주세요.')
            body = json.loads(self.rfile.read(length))
            route = self.path
            with connect() as db:
                if route == '/api/join':
                    if body.get('role') == 'teacher':
                        if not hmac.compare_digest(str(body.get('password', '')), self.server.teacher_password):
                            raise PermissionError('교사 비밀번호를 확인해 주세요.')
                        s = {'role': 'teacher'}
                    else:
                        school = db.execute('SELECT id,name FROM schools WHERE code=?', (str(body.get('code','')).strip().upper(),)).fetchone()
                        if not school:
                            raise PermissionError('학교 입장 코드를 확인해 주세요.')
                        grade, classroom, number, pin = int(body['grade']), int(body.get('classroom', 1)), int(body['number']), str(body['pin'])
                        if grade not in (5, 6) or not 1 <= classroom <= 30 or not 1 <= number <= 60 or len(pin) != 6 or not pin.isascii() or not pin.isdigit():
                            raise ValueError('학년, 반(1~30), 번호(1~60), 숫자 6자리 비밀번호를 확인해 주세요.')
                        student = db.execute('SELECT * FROM students WHERE school_id=? AND grade=? AND classroom=? AND number=?', (school['id'], grade, classroom, number)).fetchone()
                        if student:
                            if not hmac.compare_digest(student['pin'], pin_hash(pin, student['salt'])):
                                raise PermissionError('학생 비밀번호가 일치하지 않습니다.')
                            sid = student['id']
                        else:
                            salt = secrets.token_hex(16)
                            sid = db.execute('INSERT INTO students(school_id,grade,classroom,number,salt,pin) VALUES(?,?,?,?,?,?)', (school['id'], grade, classroom, number, salt, pin_hash(pin, salt))).lastrowid
                        s = {'role': 'student', 'student': sid, 'school_id':school['id'], 'school_name':school['name'], 'grade': grade, 'classroom':classroom, 'number': number}
                    s['expires'] = datetime.now().timestamp() + 8 * 3600
                    token = secrets.token_urlsafe(32)
                    SESSIONS[token] = s
                    return self.send(200, s, cookie=f'session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800')
                if route == '/api/logout':
                    c = SimpleCookie(self.headers.get('Cookie', ''))
                    if c.get('session'):
                        SESSIONS.pop(c['session'].value, None)
                    return self.send(200, {'ok': True}, cookie='session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
                if route == '/api/submit':
                    s = self.session()
                    if s['role'] != 'student':
                        raise PermissionError('학생으로 입장해 주세요.')
                    task = db.execute('SELECT * FROM tasks WHERE id=? AND grade=? AND day<=? AND (school_id IS NULL OR school_id=?)', (int(body['task']), s['grade'], today(), s['school_id'])).fetchone()
                    if not task:
                        raise ValueError('참여할 수 없는 활동입니다.')
                    answers = body.get('answers', {})
                    keys = {'word': ['meaning', 'clue', 'example'], 'sentence': ['sentence', 'reason'], 'paragraph': ['central', 'summary', 'question']}[task['kind']]
                    if not isinstance(answers, dict) or set(answers) != set(keys) or any(not isinstance(v, str) or not v.strip() or len(v) > 2000 for v in answers.values()):
                        raise ValueError('모든 답안을 2,000자 이내로 작성해 주세요.')
                    if task['kind'] == 'paragraph' and answers['central'] not in task['passage'].splitlines():
                        raise ValueError('중심 문장을 선택해 주세요.')
                    confidence = body.get('confidence')
                    if confidence not in ('도움이 필요해요', '조금 알겠어요', '설명할 수 있어요'):
                        raise ValueError('자기 점검을 선택해 주세요.')
                    encoded, stamp = json.dumps(answers, ensure_ascii=False), now()
                    db.execute('INSERT INTO responses(student,task,answers,confidence,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(student,task) DO UPDATE SET answers=excluded.answers,confidence=excluded.confidence,updated=excluded.updated', (s['student'], task['id'], encoded, confidence, stamp, stamp))
                    rid = db.execute('SELECT id FROM responses WHERE student=? AND task=?', (s['student'], task['id'])).fetchone()[0]
                    db.execute('INSERT INTO revisions(response,answers,confidence,saved) VALUES(?,?,?,?)', (rid, encoded, confidence, stamp))
                    return self.send(200, {'ok': True, 'saved': stamp})
                if route == '/api/task':
                    self.teacher()
                    values = [str(body.get(k, '')).strip() for k in ('day', 'grade', 'kind', 'title', 'passage', 'target', 'hint')]
                    day, grade, kind, title, passage, target, hint = values
                    datetime.strptime(day, '%Y-%m-%d')
                    if grade not in ('5', '6') or kind not in ('word', 'sentence', 'paragraph') or not title or not passage or len(title) > 100 or len(passage) > 6000 or len(target) > 300 or len(hint) > 1000:
                        raise ValueError('활동 내용을 확인해 주세요.')
                    if kind in ('word', 'sentence') and not target:
                        raise ValueError('핵심 낱말 또는 접속 표현을 입력해 주세요.')
                    source_note = str(body.get('source_note','')).strip()
                    school_id = int(body['school_id']) if body.get('school_id') else None
                    if len(source_note)>500:
                        raise ValueError('자료 출처 메모는 500자 이내로 작성해 주세요.')
                    if school_id is not None and not db.execute('SELECT id FROM schools WHERE id=?', (school_id,)).fetchone():
                        raise ValueError('대상 학교를 확인해 주세요.')
                    if kind == 'paragraph' and len([line for line in passage.splitlines() if line.strip()]) < 2:
                        raise ValueError('문단 활동은 문장마다 줄을 바꾸어 2문장 이상 입력해 주세요.')
                    db.execute('INSERT INTO tasks(day,grade,kind,title,passage,target,hint,school_id,source_note) VALUES(?,?,?,?,?,?,?,?,?)', (*values,school_id,source_note))
                    return self.send(200, {'ok': True})
                if route == '/api/feedback':
                    self.teacher()
                    feedback = str(body.get('feedback', '')).strip()
                    if len(feedback) > 2000:
                        raise ValueError('피드백은 2,000자 이내로 작성해 주세요.')
                    observation = str(body.get('observation','')).strip()
                    if len(observation)>2000:
                        raise ValueError('관찰 기록은 2,000자 이내로 작성해 주세요.')
                    result = db.execute('UPDATE responses SET feedback=?,observation=? WHERE id=?', (feedback,observation, int(body['id'])))
                    if result.rowcount != 1:
                        raise ValueError('답안을 찾을 수 없습니다.')
                    return self.send(200, {'ok': True})
                self.send(404, {'error': '찾을 수 없습니다.'})
        except PermissionError as e:
            self.send(401, {'error': str(e)})
        except (ValueError, KeyError, TypeError) as e:
            self.send(400, {'error': str(e) if isinstance(e, ValueError) else '입력 내용을 확인해 주세요.'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    seed()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.teacher_password = os.environ.get('MORNING_TEACHER_PASSWORD') or secrets.token_urlsafe(9)
    with connect() as db:
        codes = ', '.join(r['name'] + ': ' + r['code'] for r in db.execute('SELECT name,code FROM schools ORDER BY id'))
    print(f'Local: http://127.0.0.1:{args.port}\nSchool codes: {codes}\nTeacher password: {server.teacher_password}', flush=True)
    server.serve_forever()
