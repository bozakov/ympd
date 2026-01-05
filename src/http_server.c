/* ympd
   (c) 2013-2014 Andrew Karpow <andy@ndyk.de>
   This project's homepage is: http://www.ympd.org

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

#include "http_server.h"

#include <openssl/rand.h>
#include <string.h>

#include "mpd_client.h"

int callback_http(struct mg_connection *c) {
    const struct embedded_file *req_file;

    if (!strcmp(c->uri, "/"))
        req_file = find_embedded_file("/index.html");
    else
        req_file = find_embedded_file(c->uri);

    if (req_file) {
        mg_send_header(c, "Content-Type", req_file->mimetype);
        mg_send_data(c, req_file->data, req_file->size);

        return MG_TRUE;
    }

    if (!strcmp(c->uri, "/wss-auth")) {
        if (!mpd.wss_auth_token) {
            char salt[WSS_AUTH_TOKEN_SIZE + 1];
            for (int i = 0; i < WSS_AUTH_TOKEN_SIZE; i++) {
                int r = rand() % 26;
                salt[i] = 'A' + r;
            }
            salt[WSS_AUTH_TOKEN_SIZE] = '\0';
            mpd.wss_auth_token = strdup(salt);
            /* Debug: print token as hex */
            fprintf(stderr, "[ympd] Generated token: ");
            for (int i = 0; i < WSS_AUTH_TOKEN_SIZE; i++) fprintf(stderr, "%02X ", (unsigned char)mpd.wss_auth_token[i]);
            fprintf(stderr, "\n");
        }
        mg_send_header(c, "Content-Type", "text/plain");
        /* Always send exactly 50 bytes, no NUL terminator */
        mg_send_data(c, mpd.wss_auth_token, WSS_AUTH_TOKEN_SIZE);
        return MG_TRUE;
    }

    mg_send_status(c, 404);
    mg_printf_data(c, "Not Found");
    return MG_TRUE;
}
