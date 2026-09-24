<?php

if (!defined('ABSPATH')) {
    exit;
}

class Cerevex_Admin {
    public static function register_menu() {
        add_options_page(
            'Cerevex',
            'Cerevex',
            'manage_options',
            'cerevex',
            array(__CLASS__, 'render')
        );
    }

    public static function register_settings() {
        if (isset($_POST['cerevex_rotate_key']) && check_admin_referer('cerevex_rotate_key')) {
            if (current_user_can('manage_options')) {
                Cerevex_Auth::rotate_key();
                add_settings_error('cerevex', 'rotated', 'A new plugin key was created. Paste it in Cerevex Settings.', 'updated');
            }
        }
    }

    public static function render() {
        if (!current_user_can('manage_options')) {
            return;
        }
        $key = Cerevex_Auth::get_key();
        $site = home_url('/');
        ?>
        <div class="wrap">
            <h1>Cerevex</h1>
            <p>Install this plugin, then paste the site URL and plugin key in Cerevex Settings. Cerevex can read posts and pages. It writes title, body, and meta only after a human Approve.</p>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row">Site URL</th>
                    <td><code><?php echo esc_html($site); ?></code></td>
                </tr>
                <tr>
                    <th scope="row">Plugin key</th>
                    <td>
                        <code><?php echo esc_html($key); ?></code>
                        <p class="description">Treat this like a password. Regenerating it disconnects Cerevex until you paste the new key.</p>
                    </td>
                </tr>
            </table>
            <form method="post">
                <?php wp_nonce_field('cerevex_rotate_key'); ?>
                <button type="submit" name="cerevex_rotate_key" class="button">Make a new key</button>
            </form>
        </div>
        <?php
    }
}
