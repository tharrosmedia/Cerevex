<?php
/**
 * Plugin Name: Cerevex
 * Description: Lets Cerevex read posts and pages, then apply approved title, body, and meta changes only.
 * Version: 0.1.0
 * Author: Cerevex Engineering
 * License: GPL-2.0-or-later
 * Text Domain: cerevex
 */

if (!defined('ABSPATH')) {
    exit;
}

define('CEREVEX_PLUGIN_VERSION', '0.1.0');
define('CEREVEX_PLUGIN_FILE', __FILE__);
define('CEREVEX_PLUGIN_DIR', plugin_dir_path(__FILE__));

require_once CEREVEX_PLUGIN_DIR . 'includes/class-cerevex-auth.php';
require_once CEREVEX_PLUGIN_DIR . 'includes/class-cerevex-rest.php';
require_once CEREVEX_PLUGIN_DIR . 'includes/class-cerevex-admin.php';

register_activation_hook(__FILE__, array('Cerevex_Auth', 'activate'));

add_action('rest_api_init', array('Cerevex_Rest', 'register_routes'));
add_action('admin_menu', array('Cerevex_Admin', 'register_menu'));
add_action('admin_init', array('Cerevex_Admin', 'register_settings'));
