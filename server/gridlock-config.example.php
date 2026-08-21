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
];
