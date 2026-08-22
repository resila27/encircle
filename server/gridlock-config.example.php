<?php
return [
    'db_path' => '/home/dreamhost-user/gridlock.sqlite',
    'app_secret' => 'replace-with-at-least-32-random-bytes',
    'mail_from' => 'ENCIRCLE <noreply@playencircle.com>',
    'mail_debug_codes' => false,
    // Shared secret for the ?action=export-marketing-emails link — set this to a long random string
    // and keep it out of version control (this file is the .example template only). Leave blank to
    // disable the export entirely.
    'admin_token' => '',
    // Resend API key (resend.com) — when set, login-code emails send through Resend's API instead of
    // the server's own mail(), which has proven unreliable on shared hosting. Leave blank to fall back
    // to mail(). The "from" domain (mail_from above) must be a verified domain in your Resend account.
    'resend_api_key' => '',
];
