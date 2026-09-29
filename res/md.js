/* 轻量 Markdown 渲染器（公告用）
 * 支持：标题(#~######)、加粗、斜体、删除线、行内代码、代码块、
 *       无序/有序列表、引用、分割线、链接/图片、换行。
 * 同时允许少量安全的行内 HTML（可自定义字号、颜色等），并过滤脚本等危险内容。
 * 用法：renderMiniMarkdown(text) -> HTML 字符串
 */
(function (global) {
    'use strict';

    var ALLOWED_TAGS = ['a', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark',
        'small', 'big', 'sub', 'sup', 'span', 'font', 'div', 'p', 'br', 'hr',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'code', 'pre', 'blockquote',
        'ul', 'ol', 'li', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th'];

    var ALLOWED_ATTRS = ['style', 'class', 'href', 'src', 'alt', 'title', 'target', 'rel',
        'size', 'color', 'face', 'align', 'width', 'height', 'colspan', 'rowspan'];

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function attr(s) { return esc(s); }

    function isSafeUrl(u) {
        u = String(u || '').trim();
        if (!u) return false;
        if (/^(https?:|mailto:|tel:|\/|#|\.\.?\/)/i.test(u)) return true;
        return !/^[a-z][a-z0-9+.\-]*:/i.test(u); // 无协议的相对地址视为安全
    }

    // 过滤危险 HTML，保留白名单标签/属性
    function sanitizeHtml(html) {
        html = html.replace(/<!--[\s\S]*?-->/g, '');
        html = html.replace(/<\s*(script|style|iframe|object|embed|form|link|meta|base|svg)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
        html = html.replace(/<\s*(script|style|iframe|object|embed|form|link|meta|base|svg)\b[^>]*\/?>/gi, '');
        html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)\/?>/g, function (m, tag, rest) {
            var t = tag.toLowerCase();
            if (ALLOWED_TAGS.indexOf(t) < 0) return '';
            if (m.charAt(1) === '/') return '</' + t + '>';
            var attrs = rest.replace(/\s+([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g,
                function (am, name, _eq, val) {
                    var n = name.toLowerCase();
                    if (n.indexOf('on') === 0) return '';
                    if (ALLOWED_ATTRS.indexOf(n) < 0) return '';
                    if (val != null) {
                        var unq = val.replace(/^["']|["']$/g, '');
                        if (/^\s*javascript:/i.test(unq)) return '';
                        if ((n === 'href' || n === 'src') && !isSafeUrl(unq)) return '';
                    }
                    return am;
                });
            return '<' + t + attrs + '>';
        });
        return html;
    }

    function inline(src) {
        var stash = [];
        var s = String(src == null ? '' : src);

        // 行内代码（先取出，避免其中内容被其它规则改写）
        s = s.replace(/`([^`]+)`/g, function (m, code) {
            stash.push('<code class="md-code">' + esc(code) + '</code>');
            return '\u0001I' + (stash.length - 1) + '\u0001';
        });

        // 图片
        s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (m, alt, url, title) {
            if (!isSafeUrl(url)) return m;
            return '<img class="md-img" src="' + attr(url) + '" alt="' + attr(alt) + '"' +
                (title ? ' title="' + attr(title) + '"' : '') + '>';
        });

        // 链接
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (m, text, url, title) {
            if (!isSafeUrl(url)) return text;
            return '<a class="md-a" href="' + attr(url) + '" target="_blank" rel="noopener noreferrer"' +
                (title ? ' title="' + attr(title) + '"' : '') + '>' + text + '</a>';
        });

        // 加粗 / 斜体 / 删除线
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

        // 还原行内代码
        s = s.replace(/\u0001I(\d+)\u0001/g, function (m, n) { return stash[n]; });
        return s;
    }

    function render(src, opts) {
        opts = opts || {};
        var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
        if (opts.sanitize !== false) text = sanitizeHtml(text);

        var codeBlocks = [];
        text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, function (m, code) {
            codeBlocks.push('<pre class="md-pre"><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
            return '\n\u0001B' + (codeBlocks.length - 1) + '\u0001\n';
        });

        var lines = text.split('\n');
        var out = [];
        var list = null;
        var para = [];

        // 段落内保留换行（配合容器 white-space: pre-wrap，输入的空格/空行都会原样显示）
        function flushPara() {
            if (para.length) {
                out.push('<p class="md-p">' + para.map(inline).join('\n') + '</p>');
                para = [];
            }
        }
        function endList() {
            if (list) { out.push('</' + list + '>'); list = null; }
        }

        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i];

            var bm = ln.match(/^\u0001B(\d+)\u0001$/);
            if (bm) { flushPara(); endList(); out.push(codeBlocks[+bm[1]]); continue; }

            if (/^[ \t]*$/.test(ln)) { flushPara(); endList(); continue; }

            var h = ln.match(/^[ \t]*(#{1,6})[ \t]+(.*?)[ \t]*#*$/);
            if (h) {
                flushPara(); endList();
                var lv = h[1].length;
                out.push('<h' + lv + ' class="md-h' + lv + '">' + inline(h[2]) + '</h' + lv + '>');
                continue;
            }

            if (/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(ln)) {
                flushPara(); endList();
                out.push('<hr class="md-hr">');
                continue;
            }

            var bq = ln.match(/^[ \t]*>[ \t]?(.*)$/);
            if (bq) {
                flushPara(); endList();
                out.push('<blockquote class="md-quote">' + inline(bq[1]) + '</blockquote>');
                continue;
            }

            var ul = ln.match(/^[ \t]*[-*+][ \t]+(.*)$/);
            if (ul) {
                flushPara();
                if (list !== 'ul') { endList(); out.push('<ul class="md-ul">'); list = 'ul'; }
                out.push('<li>' + inline(ul[1]) + '</li>');
                continue;
            }

            var ol = ln.match(/^[ \t]*\d+[.)][ \t]+(.*)$/);
            if (ol) {
                flushPara();
                if (list !== 'ol') { endList(); out.push('<ol class="md-ol">'); list = 'ol'; }
                out.push('<li>' + inline(ol[1]) + '</li>');
                continue;
            }

            endList();
            para.push(ln);
        }
        flushPara(); endList();

        return out.join('\n');
    }

    global.renderMiniMarkdown = function (src, opts) { return render(src, opts); };
    global.renderMiniMarkdown.escape = esc;
    global.renderMiniMarkdown.sanitize = sanitizeHtml;
})(window);
