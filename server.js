const http = require('http'),
    crypto = require('crypto'),
    _ = require('underscore'),
    iconv = require('iconv-lite'),
    express = require('express'),
    RSS = require('rss'),
    {VM} = require('vm2');

const source = 'http://audio.gemeinderat-zuerich.ch/script/tocTab.js',
    basePath = '/podcast-gemeinderat-zuerich',
    serverName = 'feeds.gassert.ch',
    maxEntries = 10,
    cacheTTL = 3000, //seconds,
    feedOptions = {
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
            {'itunes:keywords': 'Politik, Lokalpolitik, Zürich, Schweiz, Protokolle, Reden, Transparenz'},
            {'itunes:author': 'Gemeinderat Stadt Zürich'},
            {'itunes:explicit': 'No'},
            {'itunes:owner': [{'itunes:name': 'Hannes Gassert'}, {'itunes:email': 'hannes@gassert.ch'}]},
            {'itunes:image': {_attr: {href: 'http://' + serverName + basePath + '/cover.jpg'}}},
            {'itunes:category': [{_attr: {text: 'Government & Organizations'}}]}
        ]
    };

var app = express(),
    cache = {xml: '', updated: 0};

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

// Get file size of remote file through a HTTP HEAD request
function getMP3Size(meetingNameEncoded, callback) {

    var req = http.request({
            method: 'HEAD',
            host: 'audio.gemeinderat-zuerich.ch',
            port: 80,
            path: '/audio/' + meetingNameEncoded + '/meeting.mp3',
            headers: {'User-Agent': 'Mozilla/5.0'}
        },
        function (res) {
            if (res.headers['content-length']) {
                return callback(res.headers['content-length']);
            }
            callback(0);
        });

    req.end();
}

// Generate a table of content for a specific feed item, i.e council meeting
function getItemToc(index, tocJS) {
    var regExp = new RegExp('^' + index + '\\.\\d$'),
        tmp;

    // Extract first-level agenda items, numbered 1.1, 1.2, 2.1, etc.
    tmp = _.filter(tocJS, function(item) {
        return regExp.test(item[0]);
    });

    // Extract agenda item titles
    tmp = _.map(tmp, function(item) {
        return item[1];
    });

    return tmp.join('<br/><br/>');
}

// Generate and cache the feed XML, by fetching, evaluating and dissecting a JS file from the council's website
function getFeedXML(callback) {

    if (cache.xml && cache.updated && ((Date.now() - cache.updated) < cacheTTL * 1000)) {
        return callback(cache.xml);
    }

    var feed = new RSS(feedOptions);

    http.get(source, (res) => {
        const {statusCode} = res,
            contentType = res.headers['content-type'];

        let error;

        if (statusCode !== 200) {
            error = new Error('Request Failed.\n' + `Status Code: ${statusCode}`);
        } else if (!/^application\/javascript/.test(contentType)) {
            error = new Error(`Expected application/javascript from source but received ${contentType}`);
        }
        if (error) {
            callback(null, error);
            res.resume();
            return;
        }

        let chunks = [];
        res.on('data', (chunk) => {
            chunks.push(chunk);
        });

        res.on('end', () => {

            try {
                // Execute their JS in a separate VM, evaluate and extract their variable tocTab
                var vm = new VM({timeout: 1000, sandbox: {tocLink: ''}}),
                    toc,
                    tocMain;

                vm.run(iconv.decode(Buffer.concat(chunks), 'iso-8859-1'));
                toc = vm.run('tocTab');
                tocMain = _.filter(toc, function (entry) {
                    // Integer entries are the meetings, other ones are agenda items of those meetings
                    return Number.isInteger(Number(entry[0]));
                });

                tocMain = _.first(tocMain, maxEntries);
                if (tocMain.length < maxEntries) {
                    maxEntries = tocMain.length;
                }

                _.each(tocMain, function (entry) {
                    var dateComponents = entry[1].match(/(\d+)\.(\d+)\.(\d{4})/),
                        encodedTitle = encodeURIComponent(entry[1]);

                    getMP3Size(encodedTitle, function (mp3Size) {

                        feed.item({
                            title: entry[1],
                            description: getItemToc(entry[0], toc),
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
                                type: 'audio/mpeg3',
                                size: mp3Size
                            }
                        });

                        if (feed.items.length === maxEntries) {
                            // Hack: reorder, as the async fetching of sizes might have changed the ordering
                            // Luckily the title contains the meeting number and is thus sortable as follows:
                            feed.items = _.sortBy(feed.items, 'title').reverse();
                            cache.xml = feed.xml();
                            cache.updated = Date.now();
                            callback(cache.xml);
                        }
                    });
                });

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

    getFeedXML(function (xml, err) {
        if (err) {
            console.error(err.stack);
            res.status(500).end(err.message);
            return;
        }
        res.setHeader('Content-Type', 'application/rss+xml');
        res.setHeader('Cache-Control', 'public, max-age=' + cacheTTL);
        res.end(xml);
    });
});

app.get('/', function(req, res) {
    res.redirect('https://gassert.ch/');
});

app.listen(8080);
