<?php

if (!defined('ABSPATH')) {
    exit;
}

class Cerevex_Rest {
    const ALLOWED_FIELDS = array('approved', 'approvalId', 'approvedAt', 'storeId', 'externalId', 'resourceType', 'title', 'bodyHtml', 'seoTitle', 'seoDescription');

    public static function register_routes() {
        register_rest_route('cerevex/v1', '/health', array(
            'methods' => 'GET',
            'callback' => array(__CLASS__, 'health'),
            'permission_callback' => array(__CLASS__, 'permission'),
        ));
        register_rest_route('cerevex/v1', '/content', array(
            'methods' => 'GET',
            'callback' => array(__CLASS__, 'content'),
            'permission_callback' => array(__CLASS__, 'permission'),
        ));
        register_rest_route('cerevex/v1', '/apply', array(
            'methods' => 'POST',
            'callback' => array(__CLASS__, 'apply'),
            'permission_callback' => array(__CLASS__, 'permission'),
        ));
    }

    public static function permission(WP_REST_Request $request) {
        $verified = Cerevex_Auth::verify_request($request);
        if (is_wp_error($verified)) {
            return $verified;
        }
        return true;
    }

    public static function health() {
        return rest_ensure_response(array(
            'ok' => true,
            'pluginVersion' => CEREVEX_PLUGIN_VERSION,
            'siteUrl' => home_url('/'),
        ));
    }

    public static function content(WP_REST_Request $request) {
        $type = $request->get_param('type');
        $types = array();
        if ($type === 'page' || $type === 'post') {
            $types[] = $type;
        } else {
            $types = array('post', 'page');
        }
        $items = array();
        foreach ($types as $post_type) {
            $query = new WP_Query(array(
                'post_type' => $post_type,
                'post_status' => array('publish', 'draft', 'pending', 'private'),
                'posts_per_page' => 200,
                'orderby' => 'modified',
                'order' => 'DESC',
                'no_found_rows' => true,
            ));
            foreach ($query->posts as $post) {
                $items[] = self::map_post($post);
            }
            wp_reset_postdata();
        }
        return rest_ensure_response(array(
            'ok' => true,
            'items' => $items,
        ));
    }

    public static function apply(WP_REST_Request $request) {
        $params = $request->get_json_params();
        if (!is_array($params)) {
            return new WP_Error('cerevex_invalid', 'That change is not valid.', array('status' => 400));
        }
        foreach (array_keys($params) as $key) {
            if (!in_array($key, self::ALLOWED_FIELDS, true)) {
                return new WP_Error('cerevex_unsupported_field', 'Only title, body, and meta can be changed.', array('status' => 400));
            }
        }
        if (empty($params['approved']) || $params['approved'] !== true) {
            return new WP_Error('cerevex_unapproved', 'The site rejected an unapproved change. Nothing was written.', array('status' => 403));
        }
        if (empty($params['approvalId']) || empty($params['approvedAt'])) {
            return new WP_Error('cerevex_unapproved', 'The site rejected an unapproved change. Nothing was written.', array('status' => 403));
        }
        if (empty($params['externalId']) || !in_array($params['resourceType'] ?? '', array('post', 'page'), true)) {
            return new WP_Error('cerevex_invalid', 'That change is not valid.', array('status' => 400));
        }

        $post_id = (int) $params['externalId'];
        $post = get_post($post_id);
        if (!$post || $post->post_type !== $params['resourceType']) {
            return new WP_Error('cerevex_invalid', 'That change is not valid.', array('status' => 404));
        }

        $before = self::map_post($post);
        $update = array('ID' => $post_id);
        if (isset($params['title'])) {
            $update['post_title'] = wp_kses_post($params['title']);
        }
        if (isset($params['bodyHtml'])) {
            $update['post_content'] = wp_kses_post($params['bodyHtml']);
        }
        $updated = wp_update_post($update, true);
        if (is_wp_error($updated)) {
            return new WP_Error('cerevex_plugin_down', "Couldn't reach the site.", array('status' => 500));
        }

        if (isset($params['seoTitle']) || isset($params['seoDescription'])) {
            self::write_meta($post_id, $params['seoTitle'] ?? null, $params['seoDescription'] ?? null);
        }

        $after = self::map_post(get_post($post_id));
        return rest_ensure_response(array(
            'ok' => true,
            'writes' => true,
            'externalId' => (string) $post_id,
            'approvalId' => $params['approvalId'],
            'before' => array(
                'title' => $before['title'],
                'seoTitle' => $before['seoTitle'],
                'seoDescription' => $before['seoDescription'],
            ),
            'after' => array(
                'title' => $after['title'],
                'seoTitle' => $after['seoTitle'],
                'seoDescription' => $after['seoDescription'],
            ),
        ));
    }

    private static function map_post($post) {
        $meta = self::read_meta($post->ID);
        return array(
            'externalId' => (string) $post->ID,
            'resourceType' => $post->post_type === 'page' ? 'page' : 'post',
            'handle' => $post->post_name,
            'title' => $post->post_title,
            'bodyHtml' => $post->post_content,
            'seoTitle' => $meta['title'],
            'seoDescription' => $meta['description'],
            'published' => $post->post_status === 'publish',
            'updatedAt' => $post->post_modified_gmt,
            'status' => $post->post_status,
        );
    }

    /**
     * v1 meta title/description. Writes both Yoast and Rank Math keys when present
     * so exact plugin mapping can be tightened later without a second apply path.
     */
    private static function read_meta($post_id) {
        $title = get_post_meta($post_id, '_yoast_wpseo_title', true);
        $desc = get_post_meta($post_id, '_yoast_wpseo_metadesc', true);
        if ($title === '') {
            $title = get_post_meta($post_id, 'rank_math_title', true);
        }
        if ($desc === '') {
            $desc = get_post_meta($post_id, 'rank_math_description', true);
        }
        return array(
            'title' => is_string($title) ? $title : '',
            'description' => is_string($desc) ? $desc : '',
        );
    }

    private static function write_meta($post_id, $title, $description) {
        if ($title !== null) {
            update_post_meta($post_id, '_yoast_wpseo_title', sanitize_text_field($title));
            update_post_meta($post_id, 'rank_math_title', sanitize_text_field($title));
        }
        if ($description !== null) {
            update_post_meta($post_id, '_yoast_wpseo_metadesc', sanitize_text_field($description));
            update_post_meta($post_id, 'rank_math_description', sanitize_text_field($description));
        }
    }
}
