﻿"use strict";

window.cls = window.cls || {};

/**
 * @constructor
 * @extends ViewBase
 */
cls.NetworkLogView = function(id, name, container_class, html, default_handler)
{
  var MIN_RENDER_DELAY = 200;
  var DEFAULT = "default";
  var DETAILS = "details";

  this._service = new cls.NetworkLoggerService(this);
  this._container_scroll_top = 0;
  this._details_scroll_top = 0;
  this._details_scroll_left = 0;
  this._selected = null;
  this._rendertime = 0;
  this._render_timeout = 0;
  this._graph_tooltip_id = null;
  this._type_filters = null;
  this.needs_instant_update = false;

  this.createView = function(container)
  {
    if (!this.needs_instant_update)
    {
      if (this._render_timeout)
      {
        return;
      }
      else
      {
        var timedelta = Date.now() - this._rendertime;
        if (timedelta < MIN_RENDER_DELAY)
        {
          this._render_timeout = window.setTimeout(this._create_delayed_bound,
                                                   MIN_RENDER_DELAY - timedelta);
          return;
        }
      }
    }
    this.needs_instant_update = false;
    if (container)
      this._container = container;

    // the query_selector for the mode needs to be set even when there is currently no query.
    if (this.mode == DETAILS)
      this.text_search.set_query_selector("tbody:not(.network_info)");
    else
      this.text_search.set_query_selector("[handler='select-network-request']");

    if (this.query)
    {
      // this triggers _create via on_before_search
      this.text_search.update_search();
    }
    else
    {
      this._create();
    }
    this._rendertime = Date.now();
  }

  this._create = function()
  {
    var ctx = this._service.get_request_context();
    if (ctx)
    {
      // the filters need to be set when creating the view, the request_context may have changed in between
      ctx.set_filters(this._type_filters || []);
      this._render_main_view(this._container);
    }
    else
    {
      this._render_click_to_fetch_view(this._container);
    }
  };

  this._create_delayed_bound = function()
  {
    this._render_timeout = 0;
    this.update();
  }.bind(this);

  this.update_bound = this.update.bind(this);

  this.onresize = function()
  {
    this.needs_instant_update = true;
    this.update();
  }.bind(this);

  this._on_before_search_bound = function(message)
  {
    this.query = message.search_term;
    this._create();
  }.bind(this);

  this._render_details_view = function(container, selected)
  {
    var ctx = this._service.get_request_context();
    var left_val = settings.network_logger.get("detail-view-left-pos");
    left_val = Math.min(left_val, window.innerWidth - 100);
    return templates.network_log_details(ctx, selected, left_val);
  };

  this._render_click_to_fetch_view = function(container)
  {
    container.clearAndRender(
      ["div",
        ["span",
          "class", "container-button ui-button",
          "handler", "reload-window",
          "tabindex", "1"],
        ["p", ui_strings.S_RESOURCE_CLICK_BUTTON_TO_FETCH_RESOURCES],
        "class", "info-box"
      ]
    );
  };

  this._render_main_view = function(container)
  {
    var selected_viewmode = settings.network_logger.get("selected-viewmode");
    var ctx = this._service.get_request_context();
    var entries = ctx.get_entries_filtered();
    var table_template;
    if (selected_viewmode === "data")
    {
      if (!this._table)
      {
        this._table = new SortableTable(
                        this._tabledef,
                        null,
                        ["method", "responsecode", "mime", "size_h", "waiting", "duration", "graph"],
                        null,
                        null,
                        null,
                        "network-inspector"
                      );
        this._table.add_listener("after-render", this._continue_render_main);
      }

      this._table.set_data(entries);
      table_template = this._table.render();
    }
    this._continue_render_main({template: table_template}, entries);
  };

  this._continue_render_main = function(after_render_object, entries)
  {
    var table_template = after_render_object && after_render_object.template;
    var is_data_mode = Boolean(table_template);
    var ctx = this._service.get_request_context();

    // In is_data_mode, the entries have to be retrieved from the table 
    // to be in the correct order.
    if (is_data_mode)
      entries = this._table.get_data();

    /*
      hand-calculate network-url-list-container's width, so it only takes one rendering
      #network-url-list-container { width: 40%; min-width: 230px; }
    */
    var url_list_width = Math.ceil(Math.max(230, parseInt(this._container.style.width, 10) * 0.4));
    var detail_width = parseInt(this._container.style.width) - url_list_width;

    var template = ["div", templates.network_log_main(
                     ctx, entries, this._selected, detail_width, table_template
                   ), "id", "network-outer-container"];

    if (this._selected)
      template = [template, this._render_details_view(this._container, this._selected)];

    var rendered = this._container.clearAndRender(template);

    if (this._selected)
    {
      var details = rendered.querySelector(".network-details-container");
      if (details)
      {
        if (this._details_scroll_top)
          details.scrollTop = this._details_scroll_top;

        if (this._details_scroll_left)
          details.scrollLeft = this._details_scroll_left;
      }

      if (is_data_mode)
      {
        var sel_row = rendered.querySelector("tr[data-object-id='" + this._selected + "']");
        sel_row && sel_row.addClass("selected");
      }
    }

    if (this._container_scroll_top)
    {
      var outer_container = rendered.getAttribute("id") === "network-outer-container" ?
                            rendered : rendered.firstChild;
      outer_container.scrollTop = this._container_scroll_top;
    }
  }.bind(this);

  this._tabledef = {
    column_order: ["method", "responsecode", "mime", "protocol", "size", "size_h", "waiting", "duration", "started", "graph"],
    handler: "select-network-request",
    nowrap: true,
    idgetter: function(res) { return String(res.id) },
    columns: {
      method: {
        label: ui_strings.S_HTTP_LABEL_METHOD,
        headerlabel: "",
        renderer: function(entry) {
          return entry.method;
        }
      },
      responsecode: {
        label: ui_strings.S_HTTP_LABEL_RESPONSECODE,
        headertooltip: ui_strings.S_HTTP_TOOLTIP_RESPONSECODE,
        renderer: function(entry) {
          return (entry.responsecode && String(entry.responsecode)) || "";
        },
        title_getter: function(entry, renderer) {
          if (cls.ResourceUtil.http_status_codes[entry.responsecode])
            return entry.responsecode + " (" + cls.ResourceUtil.http_status_codes[entry.responsecode] +")";
          return renderer(entry);
        },
        getter: function(entry) {
          return entry.responsecode || 0;
        }
      },
      mime: {
        label: ui_strings.S_RESOURCE_ALL_TABLE_COLUMN_MIME,
        headertooltip: ui_strings.S_HTTP_TOOLTIP_MIME,
        getter: function(entry) { return entry.mime || ui_strings.S_RESOURCE_ALL_NOT_APPLICABLE },
        renderer: function(entry, getter) {
          return getter(entry)
        }
      },
      protocol: {
        label: ui_strings.S_RESOURCE_ALL_TABLE_COLUMN_PROTOCOL,
        headertooltip: ui_strings.S_HTTP_TOOLTIP_PROTOCOL,
        getter: function(entry) { return entry.urltypeName.toLowerCase() }
      },
      size: {
        label: ui_strings.S_RESOURCE_ALL_TABLE_COLUMN_SIZE,
        headertooltip: ui_strings.S_HTTP_TOOLTIP_SIZE,
        align: "right",
        getter: function(entry) { return entry.size },
        renderer: function(entry) {
          return entry.size ? String(entry.size) : ui_strings.S_RESOURCE_ALL_NOT_APPLICABLE
        }
      },
      size_h: {
        label: ui_strings.S_RESOURCE_ALL_TABLE_COLUMN_PPSIZE,
        headerlabel: ui_strings.S_RESOURCE_ALL_TABLE_COLUMN_SIZE,
        headertooltip: ui_strings.S_HTTP_TOOLTIP_SIZE_PRETTYPRINTED,
        align: "right",
        getter: function(entry) { return entry.size },
        renderer: function(entry) {
          return String(entry.size ?
                        cls.ResourceUtil.bytes_to_human_readable(entry.size) :
                        ui_strings.S_RESOURCE_ALL_NOT_APPLICABLE)
        }
      },
      waiting: {
        label: ui_strings.S_HTTP_LABEL_WAITING,
        headertooltip: ui_strings.S_HTTP_TOOLTIP_WAITING,
        align: "right",
        getter: function(entry)
        {
          if (entry.responsestart && entry.requesttime)
            return entry.responsestart - entry.requesttime;
          return "";
        },
        renderer: function(entry, getter)
        {
          var val = getter(entry);
          return val && val.toFixed(2) + "ms";
        }
      },
      started: {
        label: ui_strings.S_HTTP_LABEL_STARTED,
        headertooltip: ui_strings.S_HTTP_TOOLTIP_STARTED,
        align: "right",
        getter: function(entry)
        {
          return entry.starttime_relative;  
        },
        renderer: function(entry)
        {
          return entry.starttime_relative.toFixed(2) + "ms";
        }
      },
      duration: {
        label: ui_strings.S_HTTP_LABEL_DURATION,
        headertooltip: ui_strings.S_HTTP_TOOLTIP_DURATION,
        align: "right",
        getter: function(entry) { return entry.duration },
        renderer: function(entry) {
          var dur = entry.duration;
          return (dur && dur.toFixed(2) + "ms") || "";
        }
      },
      graph: {
        label: ui_strings.S_HTTP_LABEL_GRAPH,
        headertooltip: ui_strings.S_HTTP_TOOLTIP_GRAPH,
        attributes: ["class", "network-graph-column"],
        getter: function(entry) { return entry.starttime },
        renderer: function(entry) {
          return templates.network_graph_sections(entry, 50, entry.duration, true);
        }
      }
    }
  };

  this._on_clicked_close_bound = function(evt, target)
  {
    this._selected = null;
    this.mode = DEFAULT;
    this.needs_instant_update = true;
    this.update();
    // the arrow keys don't scroll the main container after this was closed.
    // dispatching a click event doesn't help either.
    return false;
  }.bind(this);

  this._on_start_resize_detail_bound = function(evt, target)
  {
    document.addEventListener("mousemove", this._on_drag_detail_bound, false);
    document.addEventListener("mouseup", this._on_stop_resize_detail_bound, false);
    if (!this._resize_interval)
      this._resize_interval = setInterval(this._on_drag_interval_bound, 30);

    evt.preventDefault();
  }.bind(this);

  this._on_drag_detail_bound = function(evt)
  {
    this._resize_detail_evt = evt;
  }.bind(this);

  this._on_drag_interval_bound = function()
  {
    var container = document.querySelector(".network-details-container");
    if (container && this._resize_detail_evt)
    {
      this._detail_left = Math.max(this._resize_detail_evt.clientX, 15);
      this._detail_left = Math.min(this._detail_left, window.innerWidth - 100);
      container.style.left = this._detail_left + "px";
      settings.network_logger.set("detail-view-left-pos", this._detail_left);
    }
  }.bind(this);

  this._on_stop_resize_detail_bound = function(evt)
  {
    document.removeEventListener("mousemove", this._on_drag_detail_bound, false);
    document.removeEventListener("mouseup", this._on_stop_resize_detail_bound, false);
    this._resize_interval = clearInterval(this._resize_interval);
    this._resize_detail_evt = null;
  }.bind(this);

  var _make_selection_func = function(accessor)
  {
    if (this._selected)
    {
      var selected_node = document.querySelector("[data-object-id='" + this._selected + "']");
      if (selected_node && 
          selected_node[accessor] && 
          selected_node[accessor].dataset.objectId)
      {
        this._selected = selected_node[accessor].dataset.objectId;
        selected_node = document.querySelector("[data-object-id='" + this._selected + "']");
        if (selected_node)
        {
          var outer_container = this._container.firstChild;
          var selected_ypos = selected_node.offsetTop + selected_node.offsetHeight;
          if (selected_ypos > (outer_container.offsetHeight + this._container_scroll_top))
          {
            // scroll down to node
            this._container_scroll_top = selected_ypos - outer_container.offsetHeight;
          }
          else if (selected_node.offsetTop < this._container_scroll_top)
          {
            // scroll up to node
            this._container_scroll_top = selected_node.offsetTop;
          }
        }
        this.needs_instant_update = true;
        this.update();
        return false;
      }
    }
  };

  this._on_clicked_request_bound = function(evt, target)
  {
    var item_id = target.get_attr("parent-node-chain", "data-object-id");
    if (this._selected == item_id)
    {
      this._selected = null;
      this.mode = DEFAULT;
    }
    else
    {
      this._selected = item_id;
      this.mode = DETAILS;
    }
    this.needs_instant_update = true;
    this.update();
    if (this.graph_tooltip)
    {
      this.graph_tooltip.hide();
    }
  }.bind(this);

  this._on_mouseover_entry_bound = function(evt, target)
  {
    var item_id = target.get_attr("parent-node-chain", "data-object-id");
    var over = this._container.querySelectorAll("[data-object-id='" + item_id + "']");
    for (var n=0, e; e = over[n]; n++) { e.addClass("hovered"); }
  }.bind(this);

  this._on_mouseout_entry_bound = function(evt, target)
  {
    var item_id = target.get_attr("parent-node-chain", "data-object-id");
    var out = this._container.querySelectorAll("[data-object-id='" + item_id + "']");
    for (var n=0, e; e = out[n]; n++) { e.removeClass("hovered"); }
  }.bind(this);

  this._on_scroll_bound = function(evt, target)
  {
    if (evt.target.hasClass("network-details-container"))
    {
      this._details_scroll_top = evt.target.scrollTop;
      this._details_scroll_left = evt.target.scrollLeft;
    }
    else
    {
      this._container_scroll_top = target.firstChild.scrollTop;
    }
  }.bind(this)

  this._on_clicked_get_body = function(evt, target)
  {
    var item_id = target.getAttribute("data-object-id");
    this.needs_instant_update = true;
    this._service.get_body(item_id, this.update_bound);
  }.bind(this);

  this._on_graph_tooltip_bound = function(evt, target)
  {
    var ctx = this._service.get_request_context();
    this._graph_tooltip_id = target.get_attr("parent-node-chain", "data-object-id");
    var entry = ctx.get_entry(this._graph_tooltip_id);
    if (!this.mono_lineheight)
      this._update_mono_lineheight();

    var template = templates.network_graph_tooltip(entry, this.mono_lineheight);
    this.graph_tooltip.show(template);
  }.bind(this);

  this._on_graph_tooltip_enter_bound = function(evt, target)
  {
    if (!this._graph_tooltip_id)
      return;

    var elems = this._container.querySelectorAll("[data-object-id='" + this._graph_tooltip_id + "']");
    for (var i = 0, elem; elem = elems[i]; i++)
      elem.addClass("hovered");

  }.bind(this);

  this._on_graph_tooltip_leave_bound = function(evt, target)
  {
    if (!this._graph_tooltip_id)
      return;

    var elems = this._container.querySelectorAll("[data-object-id='" + this._graph_tooltip_id + "']");
    for (var i = 0, elem; elem = elems[i]; i++)
      elem.removeClass("hovered");

    this._graph_tooltip_id = null;
  }.bind(this);

  this._on_url_tooltip_bound = function(evt, target)
  {
    var ctx = this._service.get_request_context();
    var entry_id = target.get_attr("parent-node-chain", "data-object-id");
    var entry = ctx.get_entry(entry_id);
    if (entry)
    {
      var template = templates.network_log_url_tooltip(entry);
      this.url_tooltip.show(template);
    }
  }.bind(this);

  this._update_mono_lineheight = function()
  {
    this.mono_lineheight = window.defaults["js-source-line-height"];
  }.bind(this);

  this.url_tooltip = Tooltips.register("network-url-list-tooltip", true, false);
  this.url_tooltip.ontooltip = this._on_url_tooltip_bound;

  this.graph_tooltip = Tooltips.register("network-graph-tooltip", true, false);
  this.graph_tooltip.ontooltip = this._on_graph_tooltip_bound;
  this.graph_tooltip.ontooltipenter = this._on_graph_tooltip_enter_bound;
  this.graph_tooltip.ontooltipleave = this._on_graph_tooltip_leave_bound;

  this._on_clear_log_bound = function(evt, target)
  {
    this._service.clear_request_context();
    this.needs_instant_update = true;
    this.update();
  }.bind(this);

  this._on_close_incomplete_warning_bound = function(evt, target)
  {
    var ctx = this._service.get_request_context();
    if (ctx)
      ctx.incomplete_warn_discarded = true;

    this.needs_instant_update = true;
    this.update();
  }.bind(this);

  this._on_turn_off_incomplete_warning = function(evt, target)
  {
    settings.network_logger.set("show-incomplete-warning", false);
  };

  this._on_setting_changed_bound = function(message)
  {
    switch (message.id)
    {
      case "monospacefont":
      {
        this.mono_lineheight = null;
        break;
      }
      case "network_logger":
      {
        if (message.key === "pause")
        {
          var is_paused = this._service.is_paused;
          var pause = settings.network_logger.get(message.key);
          if (is_paused && !pause)
            this._service.unpause();
          else if (!is_paused && pause)
            this._service.pause();
        }
        if (message.key !== "detail-view-left-pos")
        {
          this.needs_instant_update = true;
          this.update();
        }
        break;
      }
    }
  }.bind(this);

  this._map_filter_bound = function(filter_name)
  {
    return {
      all: {
        type_list: [],
        "is_blacklist": true
      },
      markup: {
        type_list: ["markup"]
      },
      css: {
        type_list:["css"]
      },
      script: {
        type_list:["script"]
      },
      image: {
        type_list:["image"]
      },
      other_types: {
        type_list:["markup", "css", "script", "image"],
        "is_blacklist": true
      },
      xhr: {
        origin_list:["xhr"]
      }
    }[filter_name];
  }.bind(this);

  this._on_single_select_changed_bound = function(message)
  {
    if (message.view_id === "network_logger")
    {
      if (message.name === "selected-viewmode")
      {
        settings.network_logger.set(message.name, message.values[0]);
      }
      else if (message.name === "type-filter")
      {
        this._type_filters = message.values.map(this._map_filter_bound);
      }
      this.needs_instant_update = true;
      this.update();
    }
  }.bind(this);

  var eh = window.eventHandlers;

  eh.click["select-network-request"] = this._on_clicked_request_bound;
  eh.mouseover["select-network-request"] = this._on_mouseover_entry_bound;
  eh.mouseout["select-network-request"] = this._on_mouseout_entry_bound;
  eh.scroll["network-logger"] = this._on_scroll_bound;

  eh.click["close-request-detail"] = this._on_clicked_close_bound;
  eh.mousedown["resize-request-detail"] = this._on_start_resize_detail_bound;
  eh.click["get-response-body"] = this._on_clicked_get_body;

  eh.click["toggle-raw-cooked-response"] = this._on_clicked_toggle_response_bound;
  eh.click["toggle-raw-cooked-request"] = this._on_clicked_toggle_request_bound;
  eh.click["clear-log-network-view"] = this._on_clear_log_bound;
  
  messages.addListener("single-select-changed", this._on_single_select_changed_bound);
  messages.addListener("setting-changed", this._on_setting_changed_bound);
  eh.click["select-network-viewmode"] = this._on_select_network_viewmode_bound;
  eh.click["type-filter-network-view"] = this._on_change_type_filter_bound;

  eh.click["close-incomplete-warning"] = this._on_close_incomplete_warning_bound;
  eh.click["turn-off-incomplete-warning"] = this._on_turn_off_incomplete_warning;

  ActionHandlerInterface.apply(this);
  this._handlers = {
    "select-next-entry": _make_selection_func.bind(this, "nextElementSibling"),
    "select-previous-entry": _make_selection_func.bind(this, "previousElementSibling"),
    "close-details": this._on_clicked_close_bound
  };
  this.id = id;
  ActionBroker.get_instance().register_handler(this);

  this._type_filters = ["all"].map(this._map_filter_bound);
  this.init(id, name, container_class, html, default_handler);
};
cls.NetworkLogView.prototype = ViewBase;

cls.NetworkLog = {};
cls.NetworkLog.create_ui_widgets = function()
{
  new Settings(
    // view_id
    "network_logger",
    // key-value map
    {
      "selected-viewmode": "graphs",
      "pause": false,
      "detail-view-left-pos": 120,
      "show-incomplete-warning": true,
      "track-content": true
    },
    // key-label map
    {
      "pause": ui_strings.S_TOGGLE_PAUSED_UPDATING_NETWORK_VIEW,
      "show-incomplete-warning": ui_strings.S_NETWORK_REQUESTS_INCOMPLETE_SETTING_LABEL,
      "track-content": ui_strings.S_NETWORK_CONTENT_TRACKING_SETTING_TRACK_LABEL
    },
    // settings map
    {
      checkboxes: ["show-incomplete-warning", "track-content"]
    },
    // templates
    {
    },
    // group
    "general"
  );

  new ToolbarConfig(
    {
      view: "network_logger",
      groups: [
        {
          type: UI.TYPE_BUTTONS,
          items: [
            {
              handler: "clear-log-network-view",
              icon: "clear-log-network-view",
              title: ui_strings.S_CLEAR_NETWORK_LOG
            }
          ]
        },
        {
          type: UI.TYPE_SWITCH,
          items: [
            {
              key: "network_logger.pause",
              icon: "pause-network-view"
            }
          ]
        },
        {
          type: UI.TYPE_SINGLE_SELECT,
          name: "selected-viewmode",
          default_value: window.settings.network_logger.get("selected-viewmode"),
          items: [
            {
              value: "graphs",
              title: ui_strings.S_HTTP_LABEL_GRAPH_VIEW,
              icon: "network-view-toggle-graphs"
            },
            {
              value: "data",
              title: ui_strings.S_HTTP_LABEL_DATA_VIEW,
              icon: "network-view-toggle-data"
            }
          ]
        },
        {
          type: UI.TYPE_SINGLE_SELECT,
          name: "type-filter",
          allow_multiple_select: true,
          items: [
            {
              text: ui_strings.S_HTTP_LABEL_FILTER_ALL,
              title: ui_strings.S_HTTP_TOOLTIP_FILTER_ALL,
              value: "all"
            },
            {
              text: ui_strings.S_HTTP_LABEL_FILTER_MARKUP,
              title: ui_strings.S_HTTP_TOOLTIP_FILTER_MARKUP,
              value: "markup"
            },
            {
              text: ui_strings.S_HTTP_LABEL_FILTER_STYLESHEETS,
              title: ui_strings.S_HTTP_TOOLTIP_FILTER_STYLESHEETS,
              value: "css"
            },
            {
              text: ui_strings.S_HTTP_LABEL_FILTER_SCRIPTS,
              title: ui_strings.S_HTTP_TOOLTIP_FILTER_SCRIPTS,
              value: "script"
            },
            {
              text: ui_strings.S_HTTP_LABEL_FILTER_IMAGES,
              title: ui_strings.S_HTTP_TOOLTIP_FILTER_IMAGES,
              value: "image"
            },
            {
              text: ui_strings.S_HTTP_LABEL_FILTER_OTHER,
              title: ui_strings.S_HTTP_TOOLTIP_FILTER_OTHER,
              value: "other_types"
            },
            {
              text: ui_strings.S_HTTP_LABEL_FILTER_XHR,
              title: ui_strings.S_HTTP_TOOLTIP_FILTER_XHR,
              value: "xhr"
            }
          ]
        },
        {
          type: UI.TYPE_INPUT,
          items: [
            {
              handler: "network-text-search",
              shortcuts: "network-text-search",
              title: ui_strings.S_SEARCH_INPUT_TOOLTIP,
              label: ui_strings.S_INPUT_DEFAULT_TEXT_SEARCH
            }
          ]
        }
      ]
    }
  );

  var text_search = window.views.network_logger.text_search = new TextSearch();
  text_search.add_listener("onbeforesearch", window.views.network_logger._on_before_search_bound);

  eventHandlers.input["network-text-search"] = function(event, target)
  {
    text_search.searchDelayed(target.value);
  };
  ActionBroker.get_instance().get_global_handler().
      register_shortcut_listener("network-text-search", cls.Helpers.shortcut_search_cb.bind(text_search));

  var on_view_created = function(msg)
  {
    if (msg.id === "network_logger")
    {
      text_search.setContainer(msg.container);
      text_search.setFormInput(
        views.network_logger.getToolbarControl(msg.container, "network-text-search")
      );
    }
  }

  var on_view_destroyed = function(msg)
  {
    if (msg.id == "network_logger")
    {
      text_search.cleanup();
    }
  }

  messages.addListener("view-created", on_view_created);
  messages.addListener("view-destroyed", on_view_destroyed);
}