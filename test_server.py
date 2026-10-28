"""Integration checks against an isolated temporary classroom database."""
import http.cookiejar
import csv
import io
import json
import sqlite3
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import server

class ClassroomTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old_db = server.DB
        server.DB = Path(cls.tmp.name) / 'test.sqlite3'
        server.seed()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.http.teacher_password = 'test-teacher-only'
        cls.url = 'http://127.0.0.1:' + str(cls.http.server_port)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        server.DB = cls.old_db
        cls.tmp.cleanup()

    def client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, client, path, body=None):
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
        try:
            with client.open(req) as res:
                raw = res.read()
                return res.status, json.loads(raw) if 'application/json' in res.headers['Content-Type'] else raw
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_classroom_workflow(self):
        student, other, teacher, stranger = [self.client() for _ in range(4)]
        self.assertEqual(self.request(stranger, '/')[0], 200)
        self.assertEqual(self.request(stranger, '/api/responses')[0], 401)
        login = {'grade':5,'classroom':1,'number':1,'pin':'123456','code':'ONSAEM56'}
        self.assertEqual(self.request(student, '/api/join', login)[0], 200)
        self.assertEqual(self.request(other, '/api/join', {**login,'number':2})[0], 200)
        tasks = self.request(student, '/api/tasks')[1]
        self.assertTrue(all(t['grade'] == 5 for t in tasks))
        for task in tasks:
            answers = {
                'word': {'meaning':'상대 말을 주의 깊게 듣는 것','clue':'의견을 듣고 장점을 합했다.','example':'나는 친구의 말을 경청했다.'},
                'sentence': {'sentence':'일회용품을 줄이기로 했다. 그러나 종이컵이 많이 쓰였다.','reason':'계획과 실제 상황이 대조되기 때문이다.'},
                'paragraph': {'central':task['passage'].splitlines()[0],'summary':'텃밭에서 지식과 공동체의 태도를 함께 배운다.','question':'함께 책임을 나누려면 어떻게 해야 할까?'}
            }[task['kind']]
            payload = {'task':task['id'],'answers':answers,'confidence':'조금 알겠어요'}
            self.assertEqual(self.request(student, '/api/submit', payload)[0], 200)
            self.assertEqual(self.request(student, '/api/submit', {**payload, 'confidence':'설명할 수 있어요'})[0], 200)
        records = self.request(student, '/api/responses')[1]
        self.assertEqual(len(records), 3)
        self.assertTrue(all(len(r['revisions']) == 2 for r in records))
        self.assertEqual(self.request(other, '/api/responses')[1], [])
        self.assertEqual(self.request(student, '/api/export')[0], 401)
        self.assertEqual(self.request(student, '/api/feedback', {'id': records[0]['id'], 'feedback':'침입'})[0], 401)
        self.assertEqual(self.request(teacher, '/api/join', {'role':'teacher','password':'test-teacher-only'})[0], 200)
        self.assertEqual(len(self.request(teacher, '/api/responses')[1]), 3)
        self.assertEqual(self.request(teacher, '/api/feedback', {'id':records[0]['id'],'feedback':'근거를 잘 찾았어요.'})[0], 200)
        self.assertEqual(self.request(student, '/api/responses')[1][0]['feedback'], '근거를 잘 찾았어요.')
        self.assertEqual(self.request(teacher, '/api/export')[0], 200)
        future = {'day':'2099-01-01','grade':5,'kind':'word','title':'미래 활동','passage':'새로운 지문','target':'지문','hint':''}
        self.assertEqual(self.request(teacher, '/api/task', future)[0], 200)
        self.assertEqual(len(self.request(student, '/api/tasks')[1]), 3)
        with server.connect() as db:
            future_id = db.execute('SELECT id FROM tasks WHERE day=?', ('2099-01-01',)).fetchone()[0]
        self.assertEqual(self.request(student, '/api/submit', {'task':future_id})[0], 400)
        self.assertEqual(self.request(stranger, '/api/join', {**login,'pin':'999999'})[0], 401)
        self.assertEqual(self.request(student, '/api/logout', {})[0], 200)

        self.assertEqual(self.request(student, '/api/me')[0], 401)
        self.assertEqual(self.request(student, '/api/join', login)[0], 200)
        self.assertEqual(len(self.request(student, '/api/responses')[1]), 3)
        with server.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM revisions').fetchone()[0], 6)

        # Same grade and number are independent across schools and classrooms.
        school_two, class_two = self.client(), self.client()
        status, identity = self.request(school_two, '/api/join', {**login,'code':'DONGMYEONG56','pin':'654321'})
        self.assertEqual(status, 200)
        self.assertEqual(identity['school_name'], '동명초등학교')
        self.assertEqual(self.request(class_two, '/api/join', {**login,'classroom':2,'pin':'112233'})[0], 200)
        self.assertEqual(self.request(school_two, '/api/responses')[1], [])
        self.assertEqual(self.request(class_two, '/api/responses')[1], [])
        context = self.request(teacher, '/api/context')[1]
        self.assertNotIn('templates', context)
        self.assertNotIn('projects', context)
        self.assertEqual(self.request(student, '/api/context')[0], 401)
        local_task = {**future,'day':server.today(),'school_id':2,'source_note':'테스트 창작 지문'}
        self.assertEqual(self.request(teacher, '/api/task', local_task)[0], 200)
        available = self.request(school_two, '/api/tasks')[1]
        exclusive = next(t for t in available if t['school_id'] == 2)
        self.assertNotIn('project', exclusive)
        self.assertFalse(any(t['id'] == exclusive['id'] for t in self.request(student, '/api/tasks')[1]))
        payload = {'task':exclusive['id'],'answers':{'meaning':'뜻','clue':'근거','example':'=SUM(1,2)'},'confidence':'도움이 필요해요'}
        self.assertEqual(self.request(student, '/api/submit', payload)[0], 400)
        self.assertEqual(self.request(school_two, '/api/submit', payload)[0], 200)
        self.assertEqual(self.request(school_two, '/api/submit', {**payload,'confidence':'조금 알겠어요'})[0], 200)
        second_record = self.request(school_two, '/api/responses')[1][0]
        self.assertEqual(self.request(teacher, '/api/feedback', {'id':second_record['id'],'feedback':'다음 근거를 찾아보자.','observation':'교사 전용 메모'})[0], 200)
        self.assertNotIn('observation', self.request(school_two, '/api/responses')[1][0])
        exported = self.request(teacher, '/api/export?school=2&kind=word&classroom=1')[1].decode('utf-8-sig')
        rows = list(csv.DictReader(io.StringIO(exported)))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['학교'], '동명초등학교')
        self.assertEqual(rows[0]['현재 교사 관찰'], '교사 전용 메모')
        self.assertEqual(rows[0]['활용 문장'], "'=SUM(1,2)")
        history = self.request(teacher, '/api/export-history?school=2')[1].decode('utf-8-sig')
        history_rows = list(csv.DictReader(io.StringIO(history)))
        self.assertEqual(len(history_rows), 2)
        self.assertEqual([r['저장차례'] for r in history_rows], ['1','2'])
        self.assertEqual(self.request(student, '/api/export-history')[0], 401)
        # Repeated initialization must not duplicate tasks or change school identity.
        server.seed()
        self.assertEqual(len(self.request(student, '/api/responses')[1]), 3)

    def test_migration_preserves_records(self):
        original_db = server.DB
        try:
            server.DB = Path(self.tmp.name) / 'legacy.sqlite3'
            db = sqlite3.connect(server.DB)
            db.executescript('''
                CREATE TABLE students(id INTEGER PRIMARY KEY, grade INTEGER, number INTEGER, salt TEXT, pin TEXT, UNIQUE(grade,number));
                INSERT INTO students VALUES(77,5,60,'00','old-pin');
                CREATE TABLE tasks(id INTEGER PRIMARY KEY, day TEXT, grade INTEGER, kind TEXT, title TEXT, passage TEXT, target TEXT, hint TEXT);
                INSERT INTO tasks VALUES(88,'2026-10-24',5,'word','기존 활동','기존 지문','낱말','');
                CREATE TABLE responses(id INTEGER PRIMARY KEY, student INTEGER REFERENCES students(id), task INTEGER REFERENCES tasks(id), answers TEXT, confidence TEXT, created TEXT, updated TEXT, feedback TEXT DEFAULT '', UNIQUE(student,task));
                INSERT INTO responses VALUES(99,77,88,'{}','조금 알겠어요','old','old','유지할 피드백');
                CREATE TABLE revisions(id INTEGER PRIMARY KEY, response INTEGER REFERENCES responses(id), answers TEXT, confidence TEXT, saved TEXT);
                INSERT INTO revisions VALUES(11,99,'{}','조금 알겠어요','old');
            ''')
            db.close()
            server.seed()
            with server.connect() as db:
                s = db.execute('SELECT * FROM students WHERE id=77').fetchone()
                self.assertEqual((s['school_id'],s['classroom'],s['number']), (3,1,60))
                self.assertEqual(db.execute('SELECT feedback FROM responses WHERE id=99').fetchone()[0], '유지할 피드백')
                self.assertEqual(db.execute('SELECT response FROM revisions WHERE id=11').fetchone()[0], 99)
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertTrue(list(Path(self.tmp.name).glob('before-two-schools-*.sqlite3')))
        finally:
            server.DB = original_db

    def test_sentence_example_preserves_legacy_answers(self):
        student, teacher = self.client(), self.client()
        self.assertEqual(self.request(student, '/api/join', {'grade':5,'classroom':4,'number':58,'pin':'123456','code':'ONSAEM56'})[0], 200)
        task = next(t for t in self.request(student, '/api/tasks')[1] if t['kind'] == 'sentence')
        original = {'sentence':'비가 왔다. 그래서 실내에서 놀았다.','reason':'앞 문장이 까닭이다.'}
        payload = {'task':task['id'],'answers':original,'confidence':'조금 알겠어요'}
        self.assertEqual(self.request(student, '/api/submit', payload)[0], 200)
        self.assertEqual(self.request(student, '/api/submit', {**payload,'answer_schema':2})[0], 400)
        example = '여러 운동을 좋아한다. 예를 들어 줄넘기와 달리기를 즐긴다.'
        self.assertEqual(self.request(student, '/api/submit', {**payload,'answer_schema':2,'answers':{**original,'example':''}})[0], 400)
        self.assertEqual(self.request(student, '/api/submit', {**payload,'answer_schema':2,'answers':{**original,'example':example}})[0], 200)
        record = next(r for r in self.request(student, '/api/responses')[1] if r['task'] == task['id'])
        self.assertEqual(record['answers']['example'], example)
        self.assertEqual(record['revisions'][0]['answers'], original)
        self.assertEqual(self.request(teacher, '/api/join', {'role':'teacher','password':'test-teacher-only'})[0], 200)
        for route in ('/api/export', '/api/export-history'):
            rows = list(csv.DictReader(io.StringIO(self.request(teacher, route)[1].decode('utf-8-sig'))))
            self.assertTrue(any(r['활용 문장'] == example for r in rows))

if __name__ == '__main__':
    unittest.main()
