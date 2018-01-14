const {VM} = require('vm2'),
    http = require('http'),
    express = require('express'),
    RSS = require('rss');

const vm = new VM({
    timeout: 1000,
    sandbox: {tocLink: ''}
});

const source = 'http://audio.gemeinderat-zuerich.ch/script/tocTab.js';
const maxEntries = 10;

var app = express();

var feed = new RSS({
    title: 'Audioprotokoll Gemeinderat Stadt Zürich',
    description: '',
    feed_url: 'https://apps.gassert.ch/podcast-gemeinderat-zuerich.xml',
    site_url: 'http://audio.gemeinderat-zuerich.ch',
    image_url: 'https://apps.gassert.ch/podcast-gemeinderat-zuerich.jpg',
    webMaster: 'Hannes Gassert',
    language: 'de',
    categories: ['Government & Organizations'],
    pubDate: pubDate(),
    ttl: '180',
    custom_namespaces: {
      'itunes': 'http://www.itunes.com/dtds/podcast-1.0.dtd'
    },
    custom_elements: [
      {'itunes:subtitle': 'Weekly audio recording of the Zurich City Parliament'},
      {'itunes:summary': ''},
      {'itunes:owner': [
        {'itunes:name': 'Hannes Gassert'},
        {'itunes:email': 'hannes@gassert.ch'}
      ]},
      {'itunes:image': {
        _attr: {
          href: 'https://apps.gassert.ch/podcast-gemeinderat-zuerich.jpg'
        }
      }},
      {'itunes:category': [
        {_attr: {
          text: 'Government & Organizations'
        }}
      ]}
    ]
});

// Generate RSS Pubdate in Apple's format
function pubDate(date) {

  if (typeof date === 'undefined') {
    date = new Date();
  }

  var pieces = date.toString().split(' '),
      offsetTime = pieces[5].match(/[-+]\d{4}/),
      offset = (offsetTime) ? offsetTime : pieces[5],
      parts = [
        pieces[0] + ',',
        pieces[2],
        pieces[1],
        pieces[3],
        pieces[4],
        offset
      ];

  return parts.join(' ');
}


function getFeedXML(callback) {
    var entriesToShow = maxEntries;

    http.get(source, (res) => {
      const { statusCode } = res;
      const contentType = res.headers['content-type'];

      let error;
      if (statusCode !== 200) {
        error = new Error('Request Failed.\n' +
                          `Status Code: ${statusCode}`);
      } else if (!/^application\/javascript/.test(contentType)) {
        error = new Error('Invalid content-type.\n' +
                          `Expected application/json but received ${contentType}`);
      }
      if (error) {
        console.error(error.message);
        res.resume();
        return;
      }

      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
            vm.run(rawData);

            for (let entry of vm.run('tocTab')) {

                if (entriesToShow === 0) {
                    callback(feed.xml());
                    break;
                }

                // Integer entries are the meetings, other ones are agenda items of those meetings
                if (Number.isInteger(Number(entry[0]))) {

                    var dateComponents = entry[1].match(/(\d+)\.(\d+)\.(\d{4})/),
                        encodedTitle = encodeURIComponent(entry[1]);

                    feed.item({
                        title: entry[1],
                        description: '',
                        url: 'http://www.gemeinderat-zuerich.ch/sitzungen/protokolle/',
                        guid: source + '#' + encodedTitle,
                        date: dateComponents[3] +
                            '/' + dateComponents[2] +
                            '/' + dateComponents[1] +
                            ' 23:00',
                        enclosure: {
                            url: 'http://audio.gemeinderat-zuerich.ch/audio/' +
                                    encodedTitle +
                                    '/meeting.mp3',
                            type:' audio/mpeg3'
                        }
                    });

                    entriesToShow--;
                }
            }

        } catch (e) {
          console.error(e.message);
        }
      });
    }).on('error', (e) => {
      console.error(e.message);
    });
}

app.use(express.static(__dirname + '/static'));

app.get('/podcast-gemeinderat-zuerich.xml', function (req, res) {
  getFeedXML(function(xml){
        res.setHeader('Content-Type', 'application/rss+xml');
        res.end(xml);
    });
});

app.listen(8080);
