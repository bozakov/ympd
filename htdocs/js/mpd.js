/* ympd
   (c) 2013-2014 Andrew Karpow <andy@ndyk.de>
   This project's homepage is: https://www.ympd.org
   
   (c) 2025-2026 Zdravko Bozakov <zdravko@bozakov.com>
   This project's homepage is: https://github.com/bozakov/ympd

   This program is free software; you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation; version 2 of the License.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License along
   with this program; if not, write to the Free Software Foundation, Inc.,
   Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
*/

var TOKEN = '';

var socket;
var last_state;
var last_outputs;
var current_app;
var pagination = 0;
var browsepath = '';
var lastSongTitle = '';
var current_song = new Object();
var MAX_ELEMENTS_PER_PAGE = 512;
var isTouch = Modernizr.touch ? 1 : 0;
var filter = '';
var scrobbler = '';
var wss_auth_token = '';
var reconnect_attempts = 0;

var app = $.sammy(function () {
    function runBrowse() {
        current_app = 'queue';

        $('#breadcrump').addClass('hide');
        $('#filter').addClass('hide');
        $('#salamisandwich').removeClass('hide').find('tr:gt(0)').remove();
        if (wss_auth_token !== '')
            socket.send('MPD_API_GET_QUEUE,' + pagination);

        $('#panel-heading').text('Queue');
        $('#panel-heading-info').empty();

        $('#queue').addClass('active');
    }

    function prepare() {
        $('.nav button').removeClass('active');
        $('.page-btn').addClass('hide');
        $('#add-all-songs').hide();
        pagination = 0;
        browsepath = '';
    }

    this.get(/\#\/(\d+)/, function () {
        prepare();
        pagination = parseInt(this.params['splat'][0]);
        runBrowse();
    });

    this.get(/\#\/browse\/(\d+)\/(.*)/, function () {
        prepare();
        browsepath = this.params['splat'][1];
        pagination = parseInt(this.params['splat'][0]);
        current_app = 'browse';
        $('#breadcrump')
            .removeClass('hide')
            .empty()
            .append(
                '<li><a uri="" onclick="set_filter(\'\')">Library</a></li>'
            );
        add_filter();
        $('#salamisandwich').removeClass('hide').find('tr:gt(0)').remove();
        socket.send(
            'MPD_API_GET_BROWSE,' +
                pagination +
                ',' +
                (browsepath ? browsepath : '/')
        );
        // Don't add all songs from root
        if (browsepath) {
            $('#filter').append(
                '<button id="add-all-songs" class="btn btn-primary pull-right">Add all</button>'
            );
            var add_all_songs = $('#add-all-songs');
            add_all_songs.on('click', function () {
                socket.send('MPD_API_ADD_TRACK,' + browsepath);
            });
        }

        $('#panel-heading').text('Browse database');
        $('#panel-heading-info').empty();
        var path_array = browsepath.split('/');
        var full_path = '';
        $.each(path_array, function (index, chunk) {
            if (path_array.length - 1 == index) {
                $('#breadcrump').append(
                    '<li class="active">' + chunk + '</li>'
                );
                return;
            }

            full_path = full_path + chunk;
            $('#breadcrump').append(
                '<li><a uri="' +
                    encodeURIComponent(full_path) +
                    '">' +
                    chunk +
                    '</a></li>'
            );
            full_path += '/';
        });
        $('#browse').addClass('active');
    });

    this.get(/\#\/search\/(.*)/, function () {
        current_app = 'search';
        $('#salamisandwich').find('tr:gt(0)').remove();
        var searchstr = this.params['splat'][0];

        $('#search > div > input').val(searchstr);
        socket.send('MPD_API_SEARCH,' + searchstr);

        $('#panel-heading').text('Search: ' + searchstr);
    });

    this.get('/', function (context) {
        context.redirect('#/0');
    });
});

$(document).ready(function () {
    webSocketConnect();
    
    // Volume slider
    var volumeSlider = document.getElementById('volumeslider');
    volumeSlider.addEventListener('input', function() {
        socket.send('MPD_API_SET_VOLUME,' + this.value);
    });
    
    // Progress/seek slider
    var progressBar = document.getElementById('progressbar');
    progressBar.addEventListener('input', function() {
        if (current_song && current_song.currentSongId >= 0) {
            var seekVal = Math.ceil(current_song.totalTime * (this.value / 100));
            socket.send(
                'MPD_API_SET_SEEK,' + current_song.currentSongId + ',' + seekVal
            );
        }
    });

    $('#addstream').on('shown.bs.modal', function () {
        $('#streamurl').focus();
    });
    $('#addstream form').on('submit', function (e) {
        addStream();
    });

    if (!notificationsSupported()) $('#btnnotify').addClass('disabled');
    else if ($.cookie('notification') === 'true')
        $('#btnnotify').addClass('active');

    if ($.cookie('autoplay') === 'true') $('#btnautoplay').addClass('active');

    document.getElementById('player').addEventListener('stalled', function () {
        if (!document.getElementById('player').paused) {
            this.pause();
            clickLocalPlay();
            $('.top-right')
                .notify({
                    message: {
                        text: 'music stream stalled - trying to recover...',
                    },
                    type: 'danger',
                    fadeOut: { enabled: true, delay: 3000 },
                })
                .show();
        }
    });

    document.getElementById('player').addEventListener('pause', function () {
        this.src = '';
        this.removeAttribute('src');
        $('#localplay-icon')
            .removeClass('bi-pause-fill')
            .addClass('bi-play-fill');
    });

    document.getElementById('player').addEventListener(
        'error',
        function failed(e) {
            this.pause();
            switch (e.target.error.code) {
                case e.target.error.MEDIA_ERR_ABORTED:
                    $('.top-right')
                        .notify({
                            message: {
                                text: 'Audio playback aborted by user.',
                            },
                            type: 'info',
                            fadeOut: { enabled: true, delay: 3000 },
                        })
                        .show();
                    break;
                case e.target.error.MEDIA_ERR_NETWORK:
                    $('.top-right')
                        .notify({
                            message: {
                                text: 'Network error while playing audio.',
                            },
                            type: 'danger',
                            fadeOut: { enabled: true, delay: 3000 },
                        })
                        .show();
                    break;
                case e.target.error.MEDIA_ERR_DECODE:
                    $('.top-right')
                        .notify({
                            message: {
                                text: 'Audio playback aborted. Did you unplug your headphones?',
                            },
                            type: 'danger',
                            fadeOut: { enabled: true, delay: 3000 },
                        })
                        .show();
                    break;
                case e.target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    $('.top-right')
                        .notify({
                            message: {
                                text: 'Error while loading audio (server, network or format error).',
                            },
                            type: 'danger',
                            fadeOut: { enabled: true, delay: 3000 },
                        })
                        .show();
                    break;
                default:
                    $('.top-right')
                        .notify({
                            message: {
                                text: 'Unknown error while playing audio.',
                            },
                            type: 'danger',
                            fadeOut: { enabled: true, delay: 3000 },
                        })
                        .show();
                    break;
            }
        },
        true
    );
});

function webSocketAuthenticate() {
    var u = document.URL.split('#');
    var separator;

    if (/\/$/.test(u[0])) {
        separator = '';
    } else {
        separator = '/';
    }

    $.ajax({
        url: u[0] + separator + 'wss-auth',
        success: function (data) {
            wss_auth_token = data;
            socket.send('MPD_API_AUTHORIZE,' + wss_auth_token);
        },
    });
}

function webSocketConnect() {
    console.log('Connecting to WebSocket...');
    
    try {
        if (typeof MozWebSocket != 'undefined') {
            socket = new MozWebSocket(get_appropriate_ws_url());
        } else {
            socket = new WebSocket(get_appropriate_ws_url());
        }

        socket.onopen = function () {
            reconnect_attempts = 0;
            console.log('connected');
            $('.top-right')
                .notify({
                    message: { text: 'Connected to ympd' },
                    fadeOut: { enabled: true, delay: 2000 },
                })
                .show();

            app.run();

            if (wss_auth_token === '')
                webSocketAuthenticate();
        };
        
        socket.onerror = function(error) {
            console.log('WebSocket Error:', error);
        };

        socket.onmessage = function got_packet(msg) {
            if (msg.data === last_state || msg.data.length == 0) return;

            var obj = JSON.parse(msg.data);

            switch (obj.type) {
                case 'queue':
                    if (current_app !== 'queue') break;

                    if (obj.totalTime > 0) {
                        var hours = Math.floor(obj.totalTime / 3600);
                        var minutes =
                            Math.floor(obj.totalTime / 60) - hours * 60;
                        var seconds =
                            obj.totalTime - hours * 3600 - minutes * 60;

                        $('#panel-heading-info').text(
                            'Total: ' +
                                (hours > 0
                                    ? hours +
                                      '\u2009h ' +
                                      (minutes < 10 ? '0' : '')
                                    : '') +
                                minutes +
                                '\u2009m ' +
                                (seconds < 10 ? '0' : '') +
                                seconds +
                                '\u2009s'
                        );
                    } else {
                        $('#panel-heading-info').empty();
                    }

                    $('#salamisandwich > tbody').empty();
                    for (var song in obj.data) {
                        var minutes = Math.floor(obj.data[song].duration / 60);
                        var seconds = obj.data[song].duration - minutes * 60;

                        $('#salamisandwich > tbody').append(
                            '<tr trackid="' +
                                obj.data[song].id +
                                '"><td>' +
                                (obj.data[song].pos + 1) +
                                '</td>' +
                                '<td>' +
                                obj.data[song].artist +
                                '</td>' +
                                '<td>' +
                                obj.data[song].album +
                                '</td>' +
                                '<td>' +
                                obj.data[song].title +
                                '</td>' +
                                '<td>' +
                                minutes +
                                ':' +
                                (seconds < 10 ? '0' : '') +
                                seconds +
                                '</td><td></td></tr>'
                        );
                    }

                    if (
                        obj.data.length &&
                        obj.data[obj.data.length - 1].pos + 1 >=
                            pagination + MAX_ELEMENTS_PER_PAGE
                    )
                        $('#next').removeClass('hide');
                    if (pagination > 0) $('#prev').removeClass('hide');
                    if (isTouch) {
                        $(
                            '#salamisandwich > tbody > tr > td:last-child'
                        ).append(
                            '<a class="pull-right btn-group-hover" href="#/" ' +
                                'onclick="trash($(this).parents(\'tr\'));">' +
                                '<span class="bi bi-trash-fill"></span></a>'
                        );
                    } else {
                        $('#salamisandwich > tbody > tr').on({
                            mouseover: function () {
                                var doomed = $(this);
                                if ($('#btntrashmodeup').hasClass('active'))
                                    doomed = $(
                                        '#salamisandwich > tbody > tr:lt(' +
                                            ($(this).index() + 1) +
                                            ')'
                                    );
                                if ($('#btntrashmodedown').hasClass('active'))
                                    doomed = $(
                                        '#salamisandwich > tbody > tr:gt(' +
                                            ($(this).index() - 1) +
                                            ')'
                                    );
                                $.each(doomed, function () {
                                    if (
                                        $(this).children().last().has('a')
                                            .length == 0
                                    )
                                        $(this)
                                            .children()
                                            .last()
                                            .append(
                                                '<a class="pull-right btn-group-hover" href="#/" ' +
                                                    'onclick="trash($(this).parents(\'tr\'));">' +
                                                    '<span class="bi bi-trash-fill"></span></a>'
                                            )
                                            .find('a')
                                            .fadeTo('fast', 1);
                                });
                            },
                            mouseleave: function () {
                                var doomed = $(this);
                                if ($('#btntrashmodeup').hasClass('active'))
                                    doomed = $(
                                        '#salamisandwich > tbody > tr:lt(' +
                                            ($(this).index() + 1) +
                                            ')'
                                    );
                                if ($('#btntrashmodedown').hasClass('active'))
                                    doomed = $(
                                        '#salamisandwich > tbody > tr:gt(' +
                                            ($(this).index() - 1) +
                                            ')'
                                    );
                                $.each(doomed, function () {
                                    $(this)
                                        .children()
                                        .last()
                                        .find('a')
                                        .stop()
                                        .remove();
                                });
                            },
                        });
                    }

                    $('#salamisandwich > tbody > tr').on({
                        click: function () {
                            $('#salamisandwich > tbody > tr').removeClass(
                                'active'
                            );
                            socket.send(
                                'MPD_API_PLAY_TRACK,' + $(this).attr('trackid')
                            );
                            $(this).addClass('active');
                        },
                    });
                    //Helper function to keep table row from collapsing when being sorted
                    var fixHelperModified = function (e, tr) {
                        var $originals = tr.children();
                        var $helper = tr.clone();
                        $helper.children().each(function (index) {
                            $(this).width($originals.eq(index).width());
                        });
                        return $helper;
                    };

                    //Make queue table sortable
                    $('#salamisandwich > tbody')
                        .sortable({
                            helper: fixHelperModified,
                            stop: function (event, ui) {
                                renumber_table('#salamisandwich', ui.item);
                            },
                        })
                        .disableSelection();
                    break;
                case 'search':
                    $('#wait').modal('hide');
                case 'browse':
                    if (current_app !== 'browse' && current_app !== 'search')
                        break;

                    /* The use of encodeURIComponent() below might seem useless, but it's not. It prevents
                     * some browsers, such as Safari, from changing the normalization form of the
                     * URI from NFD to NFC, breaking our link with MPD.
                     *
                     * encodeURIComponent() instead of encodeURI() is used to ensure special characters
                     * (like e.g. +) are handled correctly.
                     */
                    if ($('#salamisandwich > tbody').is(':ui-sortable')) {
                        $('#salamisandwich > tbody').sortable('destroy');
                    }
                    for (var item in obj.data) {
                        switch (obj.data[item].type) {
                            case 'directory':
                                var clazz = 'dir';
                                if (filter !== '') {
                                    var first = basename(obj.data[item].dir)[0];
                                    if (filter === 'num' && isNaN(first)) {
                                        clazz += ' hide';
                                    } else if (
                                        filter >= 'A' &&
                                        filter <= 'Z' &&
                                        first.toUpperCase() !== filter
                                    ) {
                                        clazz += ' hide';
                                    } else if (filter === 'plist') {
                                        clazz += ' hide';
                                    }
                                }
                                $('#salamisandwich > tbody').append(
                                    '<tr uri="' +
                                        encodeURIComponent(obj.data[item].dir) +
                                        '" class="' +
                                        clazz +
                                        '">' +
                                        '<td><span class="bi bi-folder-open"></span></td>' +
                                        '<td colspan="3"><a>' +
                                        basename(obj.data[item].dir) +
                                        '</a></td>' +
                                        '<td></td><td></td></tr>'
                                );
                                break;
                            case 'playlist':
                                var clazz = 'plist';
                                if (filter !== '' && filter !== 'plist') {
                                    clazz += ' hide';
                                }
                                $('#salamisandwich > tbody').append(
                                    '<tr uri="' +
                                        encodeURIComponent(
                                            obj.data[item].plist
                                        ) +
                                        '" class="' +
                                        clazz +
                                        '">' +
                                        '<td><span class="bi bi-music-note-list"></span></td>' +
                                        '<td colspan="3"><a>' +
                                        basename(obj.data[item].plist) +
                                        '</a></td>' +
                                        '<td></td><td></td></tr>'
                                );
                                break;
                            case 'song':
                                var minutes = Math.floor(
                                    obj.data[item].duration / 60
                                );
                                var seconds =
                                    obj.data[item].duration - minutes * 60;

                                if (obj.data[item].artist == null) {
                                    var artist = '<td colspan="2">';
                                } else {
                                    var artist =
                                        '<td>' +
                                        obj.data[item].artist +
                                        '<span>' +
                                        obj.data[item].album +
                                        '</span></td><td>';
                                }

                                $('#salamisandwich > tbody').append(
                                    '<tr uri="' +
                                        encodeURIComponent(obj.data[item].uri) +
                                        '" class="song">' +
                                        '<td><span class="bi bi-music-note-beamed"></span></td>' +
                                        '<td>' +
                                        obj.data[item].artist +
                                        '</td>' +
                                        '<td>' +
                                        obj.data[item].album +
                                        '</td>' +
                                        '<td>' +
                                        obj.data[item].title +
                                        '</td>' +
                                        '<td>' +
                                        minutes +
                                        ':' +
                                        (seconds < 10 ? '0' : '') +
                                        seconds +
                                        '</td><td></td></tr>'
                                );
                                break;
                            case 'wrap':
                                if (current_app == 'browse') {
                                    $('#next').removeClass('hide');
                                } else {
                                    $('#salamisandwich > tbody').append(
                                        '<tr><td><span class="bi bi-x-circle-fill"></span></td>' +
                                            '<td colspan="3">Too many results, please refine your search!</td>' +
                                            '<td></td><td></td></tr>'
                                    );
                                }
                                break;
                        }

                        if (pagination > 0) $('#prev').removeClass('hide');
                    }

                    function appendClickableIcon(
                        appendTo,
                        onClickAction,
                        iconClass
                    ) {
                        $(appendTo)
                            .append(
                                '<a role="button" class="pull-right btn-group-hover">' +
                                    '<i class="bi ' +
                                    iconClass +
                                    '"></i></a>'
                            )
                            .find('a')
                            .click(function (e) {
                                e.stopPropagation();
                                socket.send(
                                    onClickAction +
                                        ',' +
                                        decodeURIComponent(
                                            $(this).parents('tr').attr('uri')
                                        )
                                );
                                $('.top-right')
                                    .notify({
                                        message: {
                                            text:
                                                '"' +
                                                $(
                                                    'td:nth-last-child(3)',
                                                    $(this).parents('tr')
                                                ).text() +
                                                '" added',
                                        },
                                    })
                                    .show();
                            })
                            .fadeTo('fast', 1);
                    }

                    if (isTouch) {
                        appendClickableIcon(
                            $(
                                '#salamisandwich > tbody > tr.dir > td:last-child'
                            ),
                            'MPD_API_ADD_TRACK',
                            'plus'
                        );
                        appendClickableIcon(
                            $(
                                '#salamisandwich > tbody > tr.song > td:last-child'
                            ),
                            'MPD_API_ADD_TRACK',
                            'play'
                        );
                    } else {
                        $('#salamisandwich > tbody > tr').on({
                            mouseenter: function () {
                                if ($(this).is('.dir'))
                                    appendClickableIcon(
                                        $(this).children().last(),
                                        'MPD_API_ADD_TRACK',
                                        'plus'
                                    );
                                else if ($(this).is('.song'))
                                    appendClickableIcon(
                                        $(this).children().last(),
                                        'MPD_API_ADD_PLAY_TRACK',
                                        'play'
                                    );
                            },
                            mouseleave: function () {
                                $(this)
                                    .children()
                                    .last()
                                    .find('a')
                                    .stop()
                                    .remove();
                            },
                        });
                    }
                    $('#salamisandwich > tbody > tr').on({
                        click: function () {
                            switch ($(this).attr('class')) {
                                case 'dir':
                                    pagination = 0;
                                    browsepath = $(this).attr('uri');
                                    $('#browse > a').attr(
                                        'href',
                                        '#/browse/' +
                                            pagination +
                                            '/' +
                                            browsepath
                                    );
                                    $('#filter > a').attr(
                                        'href',
                                        '#/browse/' +
                                            pagination +
                                            '/' +
                                            browsepath
                                    );
                                    app.setLocation(
                                        '#/browse/' +
                                            pagination +
                                            '/' +
                                            browsepath
                                    );
                                    set_filter('');
                                    break;
                                case 'song':
                                    socket.send(
                                        'MPD_API_ADD_TRACK,' +
                                            decodeURIComponent(
                                                $(this).attr('uri')
                                            )
                                    );
                                    $('.top-right')
                                        .notify({
                                            message: {
                                                text:
                                                    '"' +
                                                    $(
                                                        'td:nth-last-child(3)',
                                                        this
                                                    ).text() +
                                                    '" added',
                                            },
                                        })
                                        .show();
                                    break;
                                case 'plist':
                                    socket.send(
                                        'MPD_API_ADD_PLAYLIST,' +
                                            decodeURIComponent(
                                                $(this).attr('uri')
                                            )
                                    );
                                    $('.top-right')
                                        .notify({
                                            message: {
                                                text:
                                                    '"' +
                                                    $(
                                                        'td:nth-last-child(3)',
                                                        this
                                                    ).text() +
                                                    '" added',
                                            },
                                        })
                                        .show();
                                    break;
                            }
                        },
                    });

                    $('#breadcrump > li > a').on({
                        click: function () {
                            pagination = 0;
                            browsepath = $(this).attr('uri');
                            $('#browse > a').attr(
                                'href',
                                '#/browse/' + pagination + '/' + browsepath
                            );
                            $('#filter > a').attr(
                                'href',
                                '#/browse/' + pagination + '/' + browsepath
                            );
                            app.setLocation(
                                '#/browse/' + pagination + '/' + browsepath
                            );
                            set_filter('');
                        },
                    });

                    break;
                case 'state':
                    updatePlayIcon(obj.data.state);
                    updateVolumeIcon(obj.data.volume);

                    if (JSON.stringify(obj) === JSON.stringify(last_state))
                        break;

                    current_song.totalTime = obj.data.totalTime;
                    current_song.currentSongId = obj.data.currentsongid;
                    var total_minutes = Math.floor(obj.data.totalTime / 60);
                    var total_seconds = obj.data.totalTime - total_minutes * 60;

                    var elapsed_minutes = Math.floor(obj.data.elapsedTime / 60);
                    var elapsed_seconds =
                        obj.data.elapsedTime - elapsed_minutes * 60;

                    document.getElementById('volumeslider').value = obj.data.volume;
                    $('#volume-number').text(obj.data.volume + ' %');
                    var progress = Math.floor(
                        (100 * obj.data.elapsedTime) / obj.data.totalTime
                    );
                    document.getElementById('progressbar').value = progress;

                    $('#counter').text(
                        elapsed_minutes +
                            ':' +
                            (elapsed_seconds < 10 ? '0' : '') +
                            elapsed_seconds
                    );
                    
                    // Update total time in the progress section
                    if (obj.data.totalTime > 0) {
                        $('.progress-section .time:last').text(
                            total_minutes +
                                ':' +
                                (total_seconds < 10 ? '0' : '') +
                                total_seconds
                        );
                    } else {
                        $('.progress-section .time:last').text('∞');
                    }

                    $('#salamisandwich > tbody > tr')
                        .removeClass('active')
                        .css('font-weight', '');
                    $(
                        '#salamisandwich > tbody > tr[trackid=' +
                            obj.data.currentsongid +
                            ']'
                    )
                        .addClass('active')
                        .css('font-weight', 'bold');

                    if (obj.data.random) {
                        $('#btnrandom').addClass('active').text('On');
                    } else {
                        $('#btnrandom').removeClass('active').text('Off');
                    }

                    // If MPD just became available after startup/reconnect, load the queue now.
                    requestQueueThrottled();

                    if (obj.data.consume) {
                        $('#btnconsume').addClass('active').text('On');
                    } else {
                        $('#btnconsume').removeClass('active').text('Off');
                    }

                    if (obj.data.single) {
                        $('#btnsingle').addClass('active').text('On');
                    } else {
                        $('#btnsingle').removeClass('active').text('Off');
                    }

                    if (obj.data.crossfade) {
                        $('#btncrossfade').addClass('active').text(obj.data.crossfade + 's');
                    } else {
                        $('#btncrossfade').removeClass('active').text('Off');
                    }

                    if (obj.data.repeat) {
                        $('#btnrepeat').addClass('active').text('On');
                    } else {
                        $('#btnrepeat').removeClass('active').text('Off');
                    }

                    last_state = obj;
                    break;
                case 'outputnames':
                    $('#btn-outputs-block button').remove();
                    if (Object.keys(obj.data).length) {
                        $.each(obj.data, function (id, name) {
                            var btn = $(
                                '<button class="ghost" id="btnoutput' +
                                    id +
                                    '" onclick="toggleoutput(this, ' +
                                    id +
                                    ')"><span class="bi bi-volume-up-fill"></span> ' +
                                    name +
                                    '</button>'
                            );
                            btn.appendTo($('#btn-outputs-block'));
                        });
                    } else {
                        $('#btn-outputs-block').addClass('hide');
                    }
                    /* remove cache, since the buttons have been recreated */
                    last_outputs = '';
                    break;
                case 'outputs':
                    if (JSON.stringify(obj) === JSON.stringify(last_outputs))
                        break;
                    $.each(obj.data, function (id, enabled) {
                        if (enabled) $('#btnoutput' + id).addClass('active');
                        else $('#btnoutput' + id).removeClass('active');
                    });
                    last_outputs = obj;
                    break;
                case 'channels':
                    scrobbler = '';
                    $('#love').addClass('hide');
                    if (Object.keys(obj.data).length) {
                        $.each(obj.data, function (id, name) {
                            switch (name) {
                                case 'mpdas':
                                case 'mpdscribble':
                                    scrobbler = name;
                                    $('#love').removeClass('hide');
                                default:
                                    break;
                            }
                        });
                    }
                    break;
                case 'disconnected':
                    if ($('.top-right').has('div').length == 0)
                        $('.top-right')
                            .notify({
                                message: {
                                    text: 'ympd lost connection to MPD ',
                                },
                                type: 'danger',
                                fadeOut: { enabled: true, delay: 3000 },
                            })
                            .show();
                    break;
                case 'update_queue':
                    if (current_app === 'queue')
                        socket.send('MPD_API_GET_QUEUE,' + pagination);
                    break;
                case 'song_change':
                    updatePageTitle(obj.data);
                    $('#album').text('');
                    $('#artist').text('');

                    $('#btnlove').removeClass('active');

                    $('#currenttrack').text(' ' + obj.data.title);
                    var notification =
                        '<strong><h4>' + obj.data.title + '</h4></strong>';

                    if (obj.data.artist) {
                        $('#artist').text(obj.data.artist);
                        notification += obj.data.artist + '<br />';
                    }
                    if (obj.data.album) {
                        $('#album').text(obj.data.album);
                        notification += obj.data.album + '<br />';
                    }

                    if ($.cookie('notification') === 'true')
                        songNotify(
                            obj.data.title,
                            obj.data.artist,
                            obj.data.album
                        );
                    else
                        $('.top-right')
                            .notify({
                                message: { html: notification },
                                type: 'info',
                            })
                            .show();
                    break;
                case 'mpdhost':
                    $('#mpdhost').val(obj.data.host);
                    setLocalStream(obj.data.host);
                    $('#mpdport').val(obj.data.port);
                    if (obj.data.passwort_set)
                        $('#mpd_password_set').removeClass('hide');
                    break;

                case 'authorized':
                    if (obj.data === 'true') {
                        /* emit initial request for output names */
                        socket.send('MPD_API_GET_OUTPUTS');
                        socket.send('MPD_API_GET_CHANNELS');
                        /* load queue if we're on the queue page */
                        if (current_app === 'queue') {
                            socket.send('MPD_API_GET_QUEUE,' + pagination);
                        }
                    } else webSocketAuthenticate();

                    break;

                case 'error':
                    $('.top-right')
                        .notify({
                            message: { text: obj.data },
                            type: 'danger',
                        })
                        .show();
                default:
                    break;
            }
        };

        socket.onclose = function (event) {
            console.log('disconnected (code: ' + event.code + ')');
            wss_auth_token = '';
            
            if (reconnect_attempts < 1) {
                reconnect_attempts++;
                console.log('Silent retry attempt ' + reconnect_attempts);
                setTimeout(function() {
                    webSocketConnect();
                }, 1000);
            } else {
                console.log('Connection lost. Retrying in 3 seconds...');
                $('.top-right')
                    .notify({
                        message: {
                            text: 'Connection to ympd lost, retrying in 3 seconds ',
                        },
                        type: 'danger',
                        fadeOut: { enabled: true, delay: 3000 }
                    })
                    .show();
                
                setTimeout(function() {
                    webSocketConnect();
                }, 3000);
            }
        };
    } catch (exception) {
        console.error('WebSocket creation failed:', exception);
        setTimeout(webSocketConnect, 3000);
    }
}

function get_appropriate_ws_url() {
    var pcol;
    var u = document.URL;
    var separator;

    /*
    /* We open the websocket encrypted if this page came on an
    /* https:// url itself, otherwise unencrypted
    /*/

    if (u.substring(0, 5) == 'https') {
        pcol = 'wss://';
        u = u.substr(8);
    } else {
        pcol = 'ws://';
        if (u.substring(0, 4) == 'http') u = u.substr(7);
    }

    u = u.split('#');

    if (/\/$/.test(u[0])) {
        separator = '';
    } else {
        separator = '/';
    }

    return pcol + u[0] + separator + 'ws';
}

var updateVolumeIcon = function (volume) {
    $('#volume-group').removeClass('hide');
    $('#volume-icon').removeClass('bi-volume-mute-fill');
    $('#volume-icon').removeClass('bi-volume-up-fill');
    $('#volume-icon').removeClass('bi-volume-down-fill');

    if (volume == -1) {
        $('#volume-group').addClass('hide');
    } else if (volume == 0) {
        $('#volume-icon').addClass('bi-volume-mute-fill');
    } else if (volume < 50) {
        $('#volume-icon').addClass('bi-volume-down-fill');
    } else {
        $('#volume-icon').addClass('bi-volume-up-fill');
    }
};

var updatePlayIcon = function (state) {
    $('#play-icon')
        .removeClass('bi-play-fill')
        .removeClass('bi-pause-fill');
    $('#track-icon')
        .removeClass('bi-play-fill')
        .removeClass('bi-pause-fill')
        .removeClass('bi-stop-fill');

    if (state == 1) {
        // stop
        $('#play-icon').addClass('bi-play-fill');
        $('#track-icon').addClass('bi-stop-fill');
        document.getElementById('player').pause();
    } else if (state == 2) {
        // play
        $('#play-icon').addClass('bi-pause-fill');
        $('#track-icon').addClass('bi-play-fill');
        if ($.cookie('autoplay') === 'true' && player.paused) {
            clickLocalPlay();
        }
    } else {
        // pause
        $('#play-icon').addClass('bi-play-fill');
        $('#track-icon').addClass('bi-pause-fill');
        document.getElementById('player').pause();
    }
};

var updatePageTitle = function (songInfo) {
    if (!songInfo || !songInfo.title || songInfo.title === '-') {
        document.title = 'ympd';
        return;
    }
    
    var hasArtist = songInfo.artist && songInfo.artist !== '-';
    
    if (hasArtist) {
        document.title = songInfo.artist + ' - ' + songInfo.title;
    } else {
        document.title = songInfo.title;
    }
};

function updateDB() {
    socket.send('MPD_API_UPDATE_DB');
    $('.top-right')
        .notify({
            message: { text: 'Updating MPD Database... ' },
        })
        .show();
}

function clickPlay() {
    if ($('#track-icon').hasClass('bi-stop-fill'))
        socket.send('MPD_API_SET_PLAY');
    else socket.send('MPD_API_SET_PAUSE');
}

function clickLocalPlay() {
    var player = document.getElementById('player');
    $('#localplay-icon')
        .removeClass('bi-play-fill')
        .removeClass('bi-pause-fill');

    if (!$('#track-icon').hasClass('bi-play-fill')) {
        clickPlay();
    }

    if (player.paused) {
        var mpdstream = $.cookie('mpdstream');

        if (mpdstream) {
            player.src = mpdstream;
            console.log('playing mpd stream: ' + player.src);
            player.load();
            player.play();
            $('#localplay-icon').addClass('bi-pause-fill');
        } else {
            $('#mpdstream').change(function () {
                clickLocalPlay();
                $(this).unbind('change');
            });
            $('#localplay-icon').addClass('bi-play-fill');
            getHost();
        }
    } else {
        player.pause();
    }
}

function setLocalStream(mpdhost) {
    var mpdstream = $.cookie('mpdstream');

    if (!mpdstream) {
        mpdstream = 'http://';
        if (mpdhost == '127.0.0.1') mpdstream += window.location.hostname;
        else mpdstream += mpdhost;
        mpdstream += ':8000/';

        $.cookie('mpdstream', mpdstream, { expires: 424242 });
    }

    $('#mpdstream').val(mpdstream);
    $('#mpdstream').change();
}

function trash(tr) {
    if ($('#btntrashmodeup').hasClass('active')) {
        socket.send('MPD_API_RM_RANGE,0,' + (tr.index() + 1));
        tr.remove();
    } else if ($('#btntrashmodesingle').hasClass('active')) {
        socket.send('MPD_API_RM_TRACK,' + tr.attr('trackid'));
        tr.remove();
    } else if ($('#btntrashmodedown').hasClass('active')) {
        socket.send('MPD_API_RM_RANGE,' + tr.index() + ',-1');
        tr.remove();
    }
}

function renumber_table(tableID, item) {
    was = item.children('td').first().text(); //Check if first item exists!
    is = item.index() + 1; //maybe add pagination

    if (was != is) {
        socket.send('MPD_API_MOVE_TRACK,' + was + ',' + is);
        socket.send('MPD_API_GET_QUEUE,' + pagination);
    }
}

function basename(path) {
    return path.split('/').reverse()[0];
}

function clickLove() {
    socket.send(
        'MPD_API_SEND_MESSAGE,' +
            scrobbler +
            ',' +
            ($('#btnlove').hasClass('active') ? 'unlove' : 'love')
    );
    if ($('#btnlove').hasClass('active')) $('#btnlove').removeClass('active');
    else $('#btnlove').addClass('active');
}

$('#btnrandom').on('click', function (e) {
    socket.send(
        'MPD_API_TOGGLE_RANDOM,' + ($(this).hasClass('active') ? 0 : 1)
    );
});
$('#btnconsume').on('click', function (e) {
    socket.send(
        'MPD_API_TOGGLE_CONSUME,' + ($(this).hasClass('active') ? 0 : 1)
    );
});
$('#btnsingle').on('click', function (e) {
    socket.send(
        'MPD_API_TOGGLE_SINGLE,' + ($(this).hasClass('active') ? 0 : 1)
    );
});
$('#btncrossfade').on('click', function (e) {
    socket.send(
        'MPD_API_TOGGLE_CROSSFADE,' + ($(this).hasClass('active') ? 0 : 1)
    );
});
$('#btnrepeat').on('click', function (e) {
    socket.send(
        'MPD_API_TOGGLE_REPEAT,' + ($(this).hasClass('active') ? 0 : 1)
    );
});

function toggleoutput(button, id) {
    socket.send(
        'MPD_API_TOGGLE_OUTPUT,' +
            id +
            ',' +
            ($(button).hasClass('active') ? 0 : 1)
    );
}

$('#trashmode')
    .children('button')
    .on('click', function (e) {
        $('#trashmode').children('button').removeClass('active');
        $(this).addClass('active');
    });

$('#btnnotify').on('click', function (e) {
    if ($.cookie('notification') === 'true') {
        $.cookie('notification', false);
    } else {
        Notification.requestPermission(function (permission) {
            if (!('permission' in Notification)) {
                Notification.permission = permission;
            }

            if (permission === 'granted') {
                $.cookie('notification', true, { expires: 424242 });
                $('btnnotify').addClass('active');
            }
        });
    }
});

$('#btnautoplay').on('click', function (e) {
    if ($.cookie('autoplay') === 'true') {
        $.cookie('autoplay', false);
    } else {
        $.cookie('autoplay', true, { expires: 424242 });
        $('#btnautoplay').addClass('active');
    }
});

function getHost() {
    socket.send('MPD_API_GET_MPDHOST');

    function onEnter(event) {
        if (event.which == 13) {
            confirmSettings();
        }
    }

    $('#mpdhost').keypress(onEnter);
    $('#mpdport').keypress(onEnter);
    $('#mpdstream').keypress(onEnter);
    $('#mpd_pw').keypress(onEnter);
    $('#mpd_pw_con').keypress(onEnter);
}

$('#search').submit(function () {
    app.setLocation('#/search/' + $('#search > div > input').val());
    $('#wait').modal('show');
    setTimeout(function () {
        $('#wait').modal('hide');
    }, 10000);
    return false;
});

$('.page-btn').on('click', function (e) {
    switch ($(this).text()) {
        case 'Next':
            pagination += MAX_ELEMENTS_PER_PAGE;
            break;
        case 'Previous':
            pagination -= MAX_ELEMENTS_PER_PAGE;
            if (pagination <= 0) pagination = 0;
            break;
    }

    switch (current_app) {
        case 'queue':
            app.setLocation('#/' + pagination);
            break;
        case 'browse':
            app.setLocation('#/browse/' + pagination + '/' + browsepath);
            break;
    }
    e.preventDefault();
});

function addStream() {
    if ($('#streamurl').val().length > 0) {
        socket.send('MPD_API_ADD_TRACK,' + $('#streamurl').val());
    }
    $('#streamurl').val('');
    $('#addstream').modal('hide');
}

function saveQueue() {
    if ($('#playlistname').val().length > 0) {
        socket.send('MPD_API_SAVE_QUEUE,' + $('#playlistname').val());
    }
    $('#savequeue').modal('hide');
}

function confirmSettings() {
    if ($('#mpd_pw').val().length + $('#mpd_pw_con').val().length > 0) {
        if ($('#mpd_pw').val() !== $('#mpd_pw_con').val()) {
            $('#mpd_pw_con').popover('show');
            setTimeout(function () {
                $('#mpd_pw_con').popover('hide');
            }, 2000);
            return;
        } else socket.send('MPD_API_SET_MPDPASS,' + $('#mpd_pw').val());
    }
    socket.send(
        'MPD_API_SET_MPDHOST,' + $('#mpdport').val() + ',' + $('#mpdhost').val()
    );
    $.cookie('mpdstream', $('#mpdstream').val(), { expires: 424242 });
    $('#settings').modal('hide');
}

$('#mpd_password_set > button').on('click', function (e) {
    socket.send('MPD_API_SET_MPDPASS,');
    $('#mpd_pw').val('');
    $('#mpd_pw_con').val('');
    $('#mpd_password_set').addClass('hide');
});

function notificationsSupported() {
    return 'Notification' in window;
}

function songNotify(title, artist, album) {
    /*var opt = {
        type: "list",
        title: title,
        message: title,
        items: []
    }
    if(artist.length > 0)
        opt.items.push({title: "Artist", message: artist});
    if(album.length > 0)
        opt.items.push({title: "Album", message: album});
*/
    //chrome.notifications.create(id, options, creationCallback);

    var textNotification = '';
    if (typeof artist != 'undefined' && artist.length > 0)
        textNotification += ' ' + artist;
    if (typeof album != 'undefined' && album.length > 0)
        textNotification += '\n ' + album;

    var notification = new Notification(title, {
        icon: 'assets/favicon.ico',
        body: textNotification,
    });
    setTimeout(
        function (notification) {
            notification.close();
        },
        3000,
        notification
    );
}

$(document).keydown(function (e) {
    if (e.target.tagName == 'INPUT') {
        return;
    }
    switch (e.which) {
        case 37: //left
            socket.send('MPD_API_SET_PREV');
            break;
        case 39: //right
            socket.send('MPD_API_SET_NEXT');
            break;
        case 32: //space
            clickPlay();
            break;
        default:
            return;
    }
    e.preventDefault();
});

function set_filter(c) {
    filter = c;
    $('#filter > a').removeClass('active');
    $('#f' + c).addClass('active');

    if (filter === '') {
        $('#salamisandwich > tbody > tr').removeClass('hide');
    } else if (filter === 'plist') {
        $('#salamisandwich > tbody > tr.dir').addClass('hide');
        $('#salamisandwich > tbody > tr.song').addClass('hide');
        $('#salamisandwich > tbody > tr.plist').removeClass('hide');
    } else {
        $.each($('#salamisandwich > tbody > tr'), function (i, line) {
            var first = basename($(line).attr('uri'))[0];
            if ($(line).hasClass('song')) {
                first = $(line).children().eq(3).text()[0];
            }

            if (filter === 'num') {
                if (!isNaN(first)) {
                    $(line).removeClass('hide');
                } else {
                    $(line).addClass('hide');
                }
            } else if (filter >= 'A' && filter <= 'Z') {
                if (first.toUpperCase() === filter) {
                    $(line).removeClass('hide');
                } else {
                    $(line).addClass('hide');
                }
            }
        });
    }
}

function add_filter() {
    $('#filter').empty();
    $('#filter').append(
        '&nbsp;<a onclick="set_filter(\'\')" href="#/browse/' +
            pagination +
            '/' +
            browsepath +
            '">All</a>'
    );
    $('#filter').append(
        '&nbsp;<a id="fnum" onclick="set_filter(\'num\')" href="#/browse/' +
            pagination +
            '/' +
            browsepath +
            '">#</a>'
    );

    for (i = 65; i <= 90; i++) {
        var c = String.fromCharCode(i);
        $('#filter').append(
            '&nbsp;<a id="f' +
                c +
                '" onclick="set_filter(\'' +
                c +
                '\');" href="#/browse/' +
                pagination +
                '/' +
                browsepath +
                '">' +
                c +
                '</a>'
        );
    }

    $('#filter').append(
        '&nbsp;<a id="fplist" onclick="set_filter(\'plist\')" href="#/browse/' +
            pagination +
            '/' +
            browsepath +
            '" class="bi bi-music-note-list"></a>'
    );
    $('#f' + filter).addClass('active');
    $('#filter').removeClass('hide');
}

// Modern UI navigation handler
$(document).ready(function() {
    // Handle navigation button clicks
    $('.nav button[data-href]').on('click', function() {
        var href = $(this).data('href');
        if (href) {
            window.location.hash = href;
        }
    });

    // Update toggle button states
    function updateToggleButton(btn, isActive, text) {
        if (isActive) {
            btn.addClass('active').text(text || 'On');
        } else {
            btn.removeClass('active').text(text || 'Off');
        }
    }

    // Override the original button click handlers to update UI properly
    $('#btnrandom, #btnrepeat, #btncrossfade, #btnconsume, #btnsingle').on('click', function() {
        $(this).toggleClass('active');
        var isActive = $(this).hasClass('active');
        $(this).text(isActive ? 'On' : 'Off');
    });

    // Handle trash mode buttons
    $('#trashmode button').on('click', function() {
        $('#trashmode button').removeClass('active');
        $(this).addClass('active');
    });
});
