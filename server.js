const http = require('http'),
    crypto = require('crypto'),
    express = require('express'),
    RSS = require('rss'),
    {VM} = require('vm2');

const vm = new VM({
    timeout: 1000,
    sandbox: {tocLink: ''}
});

const source = 'http://audio.gemeinderat-zuerich.ch/script/tocTab.js',
    basePath = '/podcast-gemeinderat-zuerich',
    serverName = 'feeds.gassert.ch',
    maxEntries = 10,
    cacheTTL = 1500; //seconds

var app = express(),
    cache = {xml: '', updated: 0};

var feed = new RSS({
    title: 'Audioprotokoll Gemeinderat Stadt Zürich',
    author: 'Gemeinderat der Stadt Zürich',
    description: 'Der Gemeinderat ist das Parlament der Stadt Zürich. Der Rat setzt sich aus 125 gewählten Mitgliedern zusammen. In der Regel tagt er jeden Mittwochabend von 17 Uhr bis ca. 20 Uhr im Rathaus, am Limmatquai 55. Hier werden die offiziellen Audioprotokolle als inoffizieller Podcast ausgeliefert.',
    feed_url: 'http://' + serverName + basePath + '/feed.xml',
    image_url: 'http://' + serverName + basePath + '/cover.jpg',
    site_url: 'http://audio.gemeinderat-zuerich.ch',
    webMaster: 'Hannes Gassert',
    language: 'de',
    categories: ['Government & Organizations'],
    pubDate: pubDate(),
    ttl: '180',
    custom_namespaces: {
      'itunes': 'http://www.itunes.com/dtds/podcast-1.0.dtd'
    },
    custom_elements: [
      {'itunes:subtitle': 'Jede Woche: das Audioprotokoll des #grzh.'},
      {'itunes:author': 'Gemeinderat Stadt Zürich'},
      {'itunes:explicit': 'No'},
      {'itunes:owner': [
        {'itunes:name': 'Hannes Gassert'},
        {'itunes:email': 'hannes@gassert.ch'}
      ]},
      {'itunes:image': {
        _attr: {
          href: 'http://' + serverName + basePath + '/cover.jpg'
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

    if (cache.xml && cache.updated && ((Date.now() - cache.updated) < cacheTTL * 1000)) {
        return callback(cache.xml);
    }

    http.get(source, (res) => {
      const { statusCode } = res;
      const contentType = res.headers['content-type'];

      let error;
      if (statusCode !== 200) {
        error = new Error('Request Failed.\n' +
                          `Status Code: ${statusCode}`);
      } else if (!/^application\/javascript/.test(contentType)) {
        error = new Error(`Expected application/javascript from source but received ${contentType}`);
      }
      if (error) {
        callback(null, error);
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
                    cache.xml = feed.xml();
                    cache.updated = Date.now();
                    callback(cache.xml);
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
                        guid: crypto.createHash('md5').update(source + '#' + encodedTitle).digest('hex'),
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
          callback(null, e);
        }
      });
    }).on('error', (e) => {
      callback(null, e);
    });
}

app.use(basePath, express.static(__dirname + '/static'));

app.get(basePath + '/feed.xml', function (req, res) {

  getFeedXML(function(xml, err){
        if (err) {
            console.error(err.stack);
            res.status(500).end(err.message);
            return;
        }
        res.setHeader('Content-Type', 'application/rss+xml');
        res.end(xml);
    });
});

app.listen(8080);
