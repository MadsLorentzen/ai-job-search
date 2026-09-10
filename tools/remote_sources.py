"""Read-only public WWR/Greenhouse/Lever discovery. No submission endpoints."""
import argparse
import json
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.request import Request, urlopen


class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []
    def handle_data(self, value):
        self.parts.append(value)


def plain(value):
    parser = Text(); parser.feed(value or '')
    return ' '.join(' '.join(parser.parts).split())


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'RemoteCareerSearch/1.0'}), timeout=20) as response:
        data = response.read(5_000_001)
    if len(data) > 5_000_000:
        raise ValueError('Response exceeds 5 MB')
    return data


def parse(source, payload, board=''):
    rows = []
    if source == 'wwr':
        if b'<!DOCTYPE' in payload.upper() or b'<!ENTITY' in payload.upper():
            raise ValueError('XML declarations are not supported')
        for item in ET.fromstring(payload).findall('./channel/item'):
            title = item.findtext('title', '')
            company, sep, role = title.partition(':')
            rows.append({'id': item.findtext('guid') or item.findtext('link'), 'title': role.strip() if sep else title,
                         'company': company if sep else 'Unknown', 'url': item.findtext('link'),
                         'date': item.findtext('pubDate', ''), 'location': '', 'description': plain(item.findtext('description'))})
    elif source == 'greenhouse':
        for job in json.loads(payload)['jobs']:
            rows.append({'id': str(job['id']), 'title': job['title'], 'company': board, 'url': job['absolute_url'],
                         'date': '', 'updated_at': job.get('updated_at', ''), 'location': job.get('location', {}).get('name', ''),
                         'description': plain(job.get('content'))})
    elif source == 'lever':
        for job in json.loads(payload):
            sections = ' '.join(plain(part.get('text', '')) + ' ' + plain(part.get('content', '')) for part in job.get('lists', []))
            rows.append({'id': job['id'], 'title': job['text'], 'company': board, 'url': job['hostedUrl'], 'date': '',
                         'location': job.get('categories', {}).get('location', ''),
                         'description': ' '.join([job.get('descriptionPlain') or plain(job.get('description')), sections, plain(job.get('additional'))])})
    else:
        raise ValueError('Unsupported source')
    return [dict(row, source=source, eligibility='unverified') for row in rows]


def discover(source, board=None):
    if source == 'wwr':
        return parse(source, fetch('https://weworkremotely.com/remote-jobs.rss'))
    if source not in ('greenhouse', 'lever') or not board or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', board):
        raise ValueError('Greenhouse/Lever requires a valid company board slug')
    url = f'https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true' if source == 'greenhouse' else f'https://api.lever.co/v0/postings/{board}?mode=json'
    return parse(source, fetch(url), board)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', choices=['wwr', 'greenhouse', 'lever'])
    parser.add_argument('--board')
    parser.add_argument('--query', default='')
    parser.add_argument('--limit', type=int, default=20)
    args = parser.parse_args()
    if not 1 <= args.limit <= 100:
        parser.error('--limit must be between 1 and 100')
    try:
        results = discover(args.source, args.board)
        terms = args.query.lower().split()
        results = [row for row in results if all(term in row['title'].lower() for term in terms)]
        print(json.dumps({'results': results[:args.limit], 'source': args.source}, ensure_ascii=False))
    except (ValueError, KeyError, TypeError, OSError, ET.ParseError) as exc:
        parser.exit(1, f'Source unavailable: {exc}\n')

if __name__ == '__main__':
    main()
