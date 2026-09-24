<?php

if (!defined('ABSPATH')) {
    exit;
}

class Cerevex_Auth {
    const OPTION_KEY = 'cerevex_plugin_key';
    const MAX_SKEW_SECONDS = 300;

    public static function activate() {
        if (!get_option(self::OPTION_KEY)) {
            update_option(self::OPTION_KEY, self::generate_key(), false);
        }
    }

    public static function generate_key() {
        if (function_exists('random_bytes')) {
            return bin2hex(random_bytes(32));
        }
        return hash('sha256', uniqid('cerevex', true) . wp_generate_password(32, true, true));
    }

    public static function get_key() {
        $key = (string) get_option(self::OPTION_KEY, '');
        if ($key === '') {
            $key = self::generate_key();
            update_option(self::OPTION_KEY, $key, false);
        }
        return $key;
    }

    public static function rotate_key() {
        $key = self::generate_key();
        update_option(self::OPTION_KEY, $key, false);
        return $key;
    }

    public static function verify_request(WP_REST_Request $request) {
        $timestamp = (string) $request->get_header('x-cerevex-timestamp');
        $signature = (string) $request->get_header('x-cerevex-signature');
        if ($timestamp === '' || $signature === '') {
            return new WP_Error('cerevex_unsigned', 'Unsigned request rejected.', array('status' => 401));
        }
        if (!ctype_digit($timestamp)) {
            return new WP_Error('cerevex_bad_auth', 'The plugin key was not accepted.', array('status' => 401));
        }
        // Node signs with Date.now() milliseconds.
        $ts_ms = (int) $timestamp;
        $now_ms = (int) round(microtime(true) * 1000);
        if (abs($now_ms - $ts_ms) > (self::MAX_SKEW_SECONDS * 1000)) {
            return new WP_Error('cerevex_bad_auth', 'The plugin key was not accepted.', array('status' => 401));
        }
        $route = $request->get_route();
        $path = preg_replace('#^/cerevex/v1#', '/cerevex/v1', $route);
        if (strpos($path, '/cerevex/v1') !== 0) {
            $path = '/cerevex/v1' . (strpos($route, '/') === 0 ? $route : '/' . $route);
        }
        $body = $request->get_body();
        $payload = $timestamp . "\n" . strtoupper($request->get_method()) . "\n" . $path . "\n" . $body;
        $expected = hash_hmac('sha256', $payload, self::get_key());
        if (!hash_equals($expected, strtolower($signature))) {
            return new WP_Error('cerevex_bad_auth', 'The plugin key was not accepted.', array('status' => 401));
        }
        return true;
    }
}
