import { extend, each } from './utilities.js'

/**
 * All editors should extend from this class
 */
export class AbstractEditor {
  constructor(options, defaults) {
    this.defaults = defaults
    this.jsoneditor = options.jsoneditor
    this.theme = this.jsoneditor.theme
    this.template_engine = this.jsoneditor.template
    this.iconlib = this.jsoneditor.iconlib
    this.translate = this.jsoneditor.translate || this.defaults.translate
    this.original_schema = options.schema
    this.schema = this.jsoneditor.expandSchema(this.original_schema)
    this.active = true
    this.options = extend({}, (this.options || {}), (this.schema.options || {}), (options.schema.options || {}), options)

    if (!options.path && !this.schema.id) this.schema.id = 'root'
    this.path = options.path || 'root'
    this.formname = options.formname || this.path.replace(/\.([^.]+)/g, '[$1]')

    if (this.jsoneditor.options.form_name_root) this.formname = this.formname.replace(/^root\[/, `${this.jsoneditor.options.form_name_root}[`)
    this.parent = options.parent
    this.key = this.parent !== undefined ? this.path.split('.').slice(this.parent.path.split('.').length).join('.') : this.path

    this.link_watchers = []
    this.watchLoop = false

    if (options.container) this.setContainer(options.container)
    this.registerDependencies()
  }

  onChildEditorChange(editor) {
    this.onChange(true)
  }

  notify() {
    if (this.path) this.jsoneditor.notifyWatchers(this.path)
  }

  change() {
    if (this.parent) this.parent.onChildEditorChange(this)
    else if (this.jsoneditor) this.jsoneditor.onChange()
  }

  onChange(bubble) {
    this.notify()
    if (this.watch_listener) this.watch_listener()
    if (bubble) this.change()
  }

  register() {
    this.jsoneditor.registerEditor(this)
    this.onChange()
  }

  unregister() {
    if (!this.jsoneditor) return
    this.jsoneditor.unregisterEditor(this)
  }

  getNumColumns() {
    return 12
  }

  isActive() {
    return this.active
  }

  activate() {
    this.active = true
    this.optInCheckbox.checked = true
    this.enable()
    this.change()
  }

  deactivate() {
    /* only non required properties can be deactivated. */
    if (!this.isRequired()) {
      this.active = false
      this.optInCheckbox.checked = false
      this.disable()
      this.change()
    }
  }

  registerDependencies() {
    this.dependenciesFulfilled = true
    const deps = this.options.dependencies;
    if (!deps) {
      return
    }

    const self = this;
    Object.keys(deps).forEach(dependency => {
      let path = self.path.split('.');
      path[path.length - 1] = dependency
      path = path.join('.')
      const choices = deps[dependency];
      self.jsoneditor.watch(path, () => {
        self.checkDependency(path, choices)
      })
    })
  }

  checkDependency(path, choices) {
    const wrapper = this.container || this.control;
    if (this.path === path || !wrapper || this.jsoneditor === null) {
      return
    }

    const self = this;
    const editor = this.jsoneditor.getEditor(path);
    const value = editor ? editor.getValue() : undefined;
    const previousStatus = this.dependenciesFulfilled;
    this.dependenciesFulfilled = false

    if (!editor || !editor.dependenciesFulfilled) {
      this.dependenciesFulfilled = false
    } else if (Array.isArray(choices)) {
      choices.some(choice => {
        if (value === choice) {
          self.dependenciesFulfilled = true
          return true
        }
      })
    } else if (typeof choices === 'object') {
      if (typeof value !== 'object') {
        this.dependenciesFulfilled = choices === value
      } else {
        Object.keys(choices).some(key => {
          if (!choices.hasOwnProperty(key)) {
            return false
          }
          if (!value.hasOwnProperty(key) || choices[key] !== value[key]) {
            self.dependenciesFulfilled = false
            return true
          }
          self.dependenciesFulfilled = true
        })
      }
    } else if (typeof choices === 'string' || typeof choices === 'number') {
      this.dependenciesFulfilled = value === choices
    } else if (typeof choices === 'boolean') {
      if (choices) {
        this.dependenciesFulfilled = value || value.length > 0
      } else {
        this.dependenciesFulfilled = !value || value.length === 0
      }
    }

    if (this.dependenciesFulfilled !== previousStatus) {
      this.notify()
    }

    const displayMode = this.dependenciesFulfilled ? 'block' : 'none';
    if (wrapper.tagName === 'TD') {
      for (const child in wrapper.childNodes) {
        if (wrapper.childNodes.hasOwnProperty(child)) wrapper.childNodes[child].style.display = displayMode
      }
    } else wrapper.style.display = displayMode
  }

  setContainer(container) {
    this.container = container
    if (this.schema.id) this.container.setAttribute('data-schemaid', this.schema.id)
    if (this.schema.type && typeof this.schema.type === 'string') this.container.setAttribute('data-schematype', this.schema.type)
    this.container.setAttribute('data-schemapath', this.path)
  }

  setOptInCheckbox(header) {
    /* the active/deactive checbox control. */
    const self = this;
    this.optInCheckbox = document.createElement('input')
    this.optInCheckbox.setAttribute('type', 'checkbox')
    this.optInCheckbox.setAttribute('style', 'margin: 0 10px 0 0;')
    this.optInCheckbox.classList.add('json-editor-opt-in')

    this.optInCheckbox.addEventListener('click', () => {
      if (self.isActive()) {
        self.deactivate()
      } else {
        self.activate()
      }
    })

    /* append active/deactive checkbox if show_opt_in is true */
    if (this.jsoneditor.options.show_opt_in || this.options.show_opt_in) {
      /* and control to type object editors if they are not required */
      if (this.parent && this.parent.schema.type === 'object' && !this.isRequired() && this.header) {
        this.header.appendChild(this.optInCheckbox)
        this.header.insertBefore(this.optInCheckbox, this.header.firstChild)
      }
    }
  }

  preBuild() {

  }

  build() {

  }

  postBuild() {
    this.setupWatchListeners()
    this.addLinks()
    this.setValue(this.getDefault(), true)
    this.updateHeaderText()
    this.register()
    this.onWatchedFieldChange()
  }

  setupWatchListeners() {
    const self = this;

    /* Watched fields */
    this.watched = {}
    if (this.schema.vars) this.schema.watch = this.schema.vars
    this.watched_values = {}
    this.watch_listener = () => {
      if (self.refreshWatchedFieldValues()) {
        self.onWatchedFieldChange()
      }
    }

    if (this.schema.hasOwnProperty('watch')) {
      let path; let pathParts; let first; let root; let adjustedPath;
      const myPath = self.container.getAttribute('data-schemapath');

      for (const name in this.schema.watch) {
        if (!this.schema.watch.hasOwnProperty(name)) continue
        path = this.schema.watch[name]

        if (Array.isArray(path)) {
          if (path.length < 2) continue
          pathParts = [path[0]].concat(path[1].split('.'))
        } else {
          pathParts = path.split('.')
          if (!self.theme.closest(self.container, `[data-schemaid="${pathParts[0]}"]`)) pathParts.unshift('#')
        }
        first = pathParts.shift()

        if (first === '#') first = self.jsoneditor.schema.id || 'root'

        /* Find the root node for this template variable */
        root = self.theme.closest(self.container, `[data-schemaid="${first}"]`)
        if (!root) throw new Error(`Could not find ancestor node with id ${first}`)

        /* Keep track of the root node and path for use when rendering the template */
        adjustedPath = `${root.getAttribute('data-schemapath')}.${pathParts.join('.')}`

        if (myPath.startsWith(adjustedPath)) self.watchLoop = true
        self.jsoneditor.watch(adjustedPath, self.watch_listener)

        self.watched[name] = adjustedPath
      }
    }

    /* Dynamic header */
    if (this.schema.headerTemplate) {
      this.header_template = this.jsoneditor.compileTemplate(this.schema.headerTemplate, this.template_engine)
    }
  }

  addLinks() {
    /* Add links */
    if (!this.no_link_holder) {
      this.link_holder = this.theme.getLinksHolder()
      /* if description element exists, insert the link before */
      if (typeof this.description !== 'undefined') this.description.parentNode.insertBefore(this.link_holder, this.description)
      /* otherwise just insert link at bottom of container */
      else this.container.appendChild(this.link_holder)
      if (this.schema.links) {
        for (let i = 0; i < this.schema.links.length; i++) {
          this.addLink(this.getLink(this.schema.links[i]))
        }
      }
    }
  }

  onMove() {}

  getButton(text, icon, title) {
    const btnClass = `json-editor-btn-${icon}`;
    if (!this.iconlib) icon = null
    else icon = this.iconlib.getIcon(icon)

    if (!icon && title) {
      text = title
      title = null
    }

    const btn = this.theme.getButton(text, icon, title);
    btn.classList.add(btnClass)
    return btn
  }

  setButtonText(button, text, icon, title) {
    if (!this.iconlib) icon = null
    else icon = this.iconlib.getIcon(icon)

    if (!icon && title) {
      text = title
      title = null
    }

    return this.theme.setButtonText(button, text, icon, title)
  }

  addLink(link) {
    if (this.link_holder) this.link_holder.appendChild(link)
  }

  getLink(data) {
    let holder;
    let link;

    /* Get mime type of the link */
    const mime = data.mediaType || 'application/javascript';
    const type = mime.split('/')[0];

    /* Template to generate the link href */
    const href = this.jsoneditor.compileTemplate(data.href, this.template_engine);
    const relTemplate = this.jsoneditor.compileTemplate(data.rel ? data.rel : data.href, this.template_engine);

    /* Template to generate the link's download attribute */
    let download = null;
    if (data.download) download = data.download

    if (download && download !== true) {
      download = this.jsoneditor.compileTemplate(download, this.template_engine)
    }

    /* Image links */
    if (type === 'image') {
      holder = this.theme.getBlockLinkHolder()
      link = document.createElement('a')
      link.setAttribute('target', '_blank')
      const image = document.createElement('img');

      this.theme.createImageLink(holder, link, image)

      /* When a watched field changes, update the url */
      this.link_watchers.push(vars => {
        const url = href(vars);
        const rel = relTemplate(vars);
        link.setAttribute('href', url)
        link.setAttribute('title', rel || url)
        image.setAttribute('src', url)
      })
    /* Audio/Video links */
    } else if (['audio', 'video'].includes(type)) {
      holder = this.theme.getBlockLinkHolder()

      link = this.theme.getBlockLink()
      link.setAttribute('target', '_blank')

      const media = document.createElement(type);
      media.setAttribute('controls', 'controls')

      this.theme.createMediaLink(holder, link, media)

      /* When a watched field changes, update the url */
      this.link_watchers.push(vars => {
        const url = href(vars);
        const rel = relTemplate(vars);
        link.setAttribute('href', url)
        link.textContent = rel || url
        media.setAttribute('src', url)
      })
    /* Text links or blank link */
    } else {
      link = holder = this.theme.getBlockLink()
      holder.setAttribute('target', '_blank')
      holder.textContent = data.rel
      holder.style.display = 'none' /* Prevent blank links from showing up when using custom view */

      /* When a watched field changes, update the url */
      this.link_watchers.push(vars => {
        const url = href(vars);
        const rel = relTemplate(vars);
        if (url) holder.style.display = ''
        holder.setAttribute('href', url)
        holder.textContent = rel || url
      })
    }

    if (download && link) {
      if (download === true) {
        link.setAttribute('download', '')
      } else {
        this.link_watchers.push(vars => {
          link.setAttribute('download', download(vars))
        })
      }
    }

    if (data.class) link.classList.add(data.class)

    return holder
  }

  refreshWatchedFieldValues() {
    if (!this.watched_values) return
    const watched = {};
    let changed = false;
    const self = this;

    if (this.watched) {
      let val;
      let editor;
      for (const name in this.watched) {
        if (!this.watched.hasOwnProperty(name)) continue
        editor = self.jsoneditor.getEditor(this.watched[name])
        val = editor ? editor.getValue() : null
        if (self.watched_values[name] !== val) changed = true
        watched[name] = val
      }
    }

    watched.self = this.getValue()
    if (this.watched_values.self !== watched.self) changed = true

    this.watched_values = watched

    return changed
  }

  getWatchedFieldValues() {
    return this.watched_values
  }

  updateHeaderText() {
    if (this.header) {
      const headerText = this.getHeaderText();
      /* If the header has children, only update the text node's value */
      if (this.header.children.length) {
        for (let i = 0; i < this.header.childNodes.length; i++) {
          if (this.header.childNodes[i].nodeType === 3) {
            this.header.childNodes[i].nodeValue = this.cleanText(headerText)
            break
          }
        }
      /* Otherwise, just update the entire node */
      } else {
        if (window.DOMPurify) this.header.innerHTML = window.DOMPurify.sanitize(headerText)
        else this.header.textContent = this.cleanText(headerText)
      }
    }
  }

  getHeaderText(titleOnly) {
    if (this.header_text) return this.header_text
    else if (titleOnly) return this.schema.title
    else return this.getTitle()
  }

  cleanText(txt) {
    /* Clean out HTML tags from txt */
    const tmp = document.createElement('div');
    tmp.innerHTML = txt
    return (tmp.textContent || tmp.innerText)
  }

  onWatchedFieldChange() {
    let vars;
    if (this.header_template) {
      vars = extend(this.getWatchedFieldValues(), {
        key: this.key,
        i: this.key,
        i0: (this.key * 1),
        i1: (this.key * 1 + 1),
        title: this.getTitle()
      })
      const headerText = this.header_template(vars);

      if (headerText !== this.header_text) {
        this.header_text = headerText
        this.updateHeaderText()
        this.notify()
        /* this.fireChangeHeaderEvent(); */
      }
    }
    if (this.link_watchers.length) {
      vars = this.getWatchedFieldValues()
      for (let i = 0; i < this.link_watchers.length; i++) {
        this.link_watchers[i](vars)
      }
    }
  }

  setValue(value) {
    this.value = value
  }

  getValue() {
    if (!this.dependenciesFulfilled) {
      return undefined
    }
    return this.value
  }

  refreshValue() {

  }

  getChildEditors() {
    return false
  }

  destroy() {
    const self = this;
    this.unregister(this)
    each(this.watched, (name, adjustedPath) => {
      self.jsoneditor.unwatch(adjustedPath, self.watch_listener)
    })

    this.watched = null
    this.watched_values = null
    this.watch_listener = null
    this.header_text = null
    this.header_template = null
    this.value = null
    if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container)
    this.container = null
    this.jsoneditor = null
    this.schema = null
    this.path = null
    this.key = null
    this.parent = null
  }

  getDefault() {
    if (typeof this.schema['default'] !== 'undefined') {
      return this.schema['default']
    }

    if (typeof this.schema['enum'] !== 'undefined') {
      return this.schema['enum'][0]
    }

    let type = this.schema.type || this.schema.oneOf;
    if (type && Array.isArray(type)) type = type[0]
    if (type && typeof type === 'object') type = type.type
    if (type && Array.isArray(type)) type = type[0]

    if (typeof type === 'string') {
      if (type === 'number') return 0.0
      if (type === 'boolean') return false
      if (type === 'integer') return 0
      if (type === 'string') return ''
      if (type === 'object') return {}
      if (type === 'array') return []
    }

    return null
  }

  getTitle() {
    return this.schema.title || this.key
  }

  enable() {
    this.disabled = false
  }

  disable() {
    this.disabled = true
  }

  isEnabled() {
    return !this.disabled
  }

  isRequired() {
    if (typeof this.schema.required === 'boolean') return this.schema.required
    else if (this.parent && this.parent.schema && Array.isArray(this.parent.schema.required)) return this.parent.schema.required.includes(this.key);
    else if (this.jsoneditor.options.required_by_default) return true
    else return false
  }

  getDisplayText(arr) {
    const disp = [];
    const used = {};

    /* Determine how many times each attribute name is used. */
    /* This helps us pick the most distinct display text for the schemas. */
    each(arr, (i, el) => {
      if (el.title) {
        used[el.title] = used[el.title] || 0
        used[el.title]++
      }
      if (el.description) {
        used[el.description] = used[el.description] || 0
        used[el.description]++
      }
      if (el.format) {
        used[el.format] = used[el.format] || 0
        used[el.format]++
      }
      if (el.type) {
        used[el.type] = used[el.type] || 0
        used[el.type]++
      }
    })

    /* Determine display text for each element of the array */
    each(arr, (i, el) => {
      let name;

      /* If it's a simple string */
      if (typeof el === 'string') name = el
      /* Object */
      else if (el.title && used[el.title] <= 1) name = el.title
      else if (el.format && used[el.format] <= 1) name = el.format
      else if (el.type && used[el.type] <= 1) name = el.type
      else if (el.description && used[el.description] <= 1) name = el.descripton
      else if (el.title) name = el.title
      else if (el.format) name = el.format
      else if (el.type) name = el.type
      else if (el.description) name = el.description
      else if (JSON.stringify(el).length < 500) name = JSON.stringify(el)
      else name = 'type'

      disp.push(name)
    })

    /* Replace identical display text with "text 1", "text 2", etc. */
    const inc = {};
    each(disp, (i, name) => {
      inc[name] = inc[name] || 0
      inc[name]++

      if (used[name] > 1) disp[i] = `${name} ${inc[name]}`
    })

    return disp
  }

  /* Replace space(s) with "-" to create valid id value */
  getValidId(id) {
    id = id === undefined ? '' : id.toString()
    return id.replace(/\s+/g, '-')
  }

  setInputAttributes(inputAttribute) {
    if (this.schema.options && this.schema.options.inputAttributes) {
      const inputAttributes = this.schema.options.inputAttributes;
      const protectedAttributes = ['name', 'type'].concat(inputAttribute);
      for (const key in inputAttributes) {
        if (inputAttributes.hasOwnProperty(key) && !protectedAttributes.includes(key.toLowerCase())) {
          this.input.setAttribute(key, inputAttributes[key])
        }
      }
    }
  }

  expandCallbacks(scope, options) {
    for (const i in options) {
      if (options.hasOwnProperty(i) && options[i] === Object(options[i])) {
        options[i] = this.expandCallbacks(scope, options[i])
      } else if (options.hasOwnProperty(i) && typeof options[i] === 'string' && typeof this.defaults.callbacks[scope] === 'object' && typeof this.defaults.callbacks[scope][options[i]] === 'function') {
        options[i] = this.defaults.callbacks[scope][options[i]].bind(null, this)/* .bind(this); */
      }
    }
    return options
  }

  showValidationErrors(errors) {

  }
}
