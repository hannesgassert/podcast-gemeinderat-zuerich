const {VM} = require('vm2'),
    http = require('http'),
    RSS = require('rss');

const vm = new VM({
    timeout: 1000,
    sandbox: {tocLink: ''}
});

const source = 'http://audio.gemeinderat-zuerich.ch/script/tocTab.js';

var entriesToShow = 10;

var feed = new RSS({
    title: 'Audioprotokoll Gemeinderat Stadt Zürich',
    description: '',
    //feed_url: 'http://example.com/rss.xml',
    //site_url: 'http://example.com',
    image_url: 'http://audio.gemeinderat-zuerich.ch/image/menutitle.png',
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
          href: ''
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

  var pieces     = date.toString().split(' '),
      offsetTime = pieces[5].match(/[-+]\d{4}/),
      offset     = (offsetTime) ? offsetTime : pieces[5],
      parts      = [
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

                    feed.item({
                        title: entry[1],
                        description: '',
                        url: 'http://www.gemeinderat-zuerich.ch/sitzungen/protokolle/',
                        date: 'May 27, 2012', // any format that js Date can parse. // TODO
                        enclosure: {
                            url: 'http://audio.gemeinderat-zuerich.ch/audio/' +
                                    encodeURIComponent(entry[1]) +
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

const requestHandler = (request, response) => {
    getFeedXML(function(r){
        response.setHeader('Content-Type', 'application/rss+xml');
        response.end(r);
    });
};

const server = http.createServer(requestHandler);

server.listen(8080, (err) => {
  if (err) {
    return console.error(err.message);
  }
});
