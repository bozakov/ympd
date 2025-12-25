## Docker Usage

You can build and run ympd using Docker for easy deployment:

### Build the Docker image

```sh
docker build -t ympd .
```

### Run ympd with Docker

```sh
# Example: Expose web UI on port 8080 and connect to MPD at host 'mpdhost' (default port 6600)
docker run --rm -p 8080:8080 ympd -h <mpdhost> -w 8080
```

Replace `<mpdhost>` with the address of your MPD server. You can pass any ympd flags after the image name.

#### Example with custom MPD host and port:
```sh
docker run --rm -p 8080:8080 ympd -h 192.168.1.100 -p 6600 -w 8080
```

#### Example with SSL (see SSL Support section below for certificate setup):
```sh
docker run --rm -p 8081:8081 -v /path/to/ssl.pem:/ssl.pem ympd -w "ssl://8081:/ssl.pem"
```

---
[![Build Status](https://travis-ci.org/notandy/ympd.svg)](https://travis-ci.org/notandy/ympd)
ympd
====

Standalone MPD Web GUI written in C, utilizing Websockets and Bootstrap/JS

http://www.ympd.org

![ScreenShot](http://www.ympd.org/assets/ympd_github.png)

## Dependencies

-   libmpdclient 2: http://www.musicpd.org/libs/libmpdclient/
-   cmake 2.6: http://cmake.org/
-   OpenSSL: https://www.openssl.org/

apt-get install -y --no-install-recommends \
		ca-certificates \
		sudo \
		git \
		build-essential \
		cmake \
		ninja-build \
		pkg-config \
		libmpdclient-dev \
		libssl-dev \
		clang-format

## Unix Build Instructions

1. install dependencies. cmake, libmpdclient (dev), and OpenSSL (dev) are available from all major distributions.
2. create build directory `cd /path/to/ympd/src; mkdir build; cd build`
3. create makefile `cmake ../.. -DCMAKE_INSTALL_PREFIX:PATH=/usr`
4. build `make`
5. install `sudo make install` or just run with `./ympd`

## Run flags

```
Usage: ./ympd [OPTION]...

 -D, --digest <htdigest>       path to htdigest file for authorization
                               (realm ympd) [no authorization]
 -h, --host <host>             connect to mpd at host [localhost]
 -p, --port <port>             connect to mpd at port [6600]
 -w, --webport [ip:]<port>     listen interface/port for webserver [8080]
 -u, --user <username>         drop priviliges to user after socket bind
 -V, --version                 get version
 --help                        this help
```

## SSL Support

To run ympd with SSL support:

-   create a certificate (key and cert in the same file), example:

```
# openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 1000 -nodes
# cat key.pem cert.pem > ssl.pem
```

-   tell ympd to use a webport using SSL and where to find the certificate:

```
# ./ympd -w "ssl://8081:/path/to/ssl.pem"
```

## Copyright

2013-2014 <andy@ndyk.de>
