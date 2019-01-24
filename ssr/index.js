const chalk = require('chalk')
const { VUE_APOLLO_QUERY_KEYWORDS } = require('../lib/consts')
const { createFakeInstance, resolveComponent } = require('./utils')
const { Globals, getMergedDefinition, omit } = require('../lib/utils')

const config = exports.config = {
  globalPrefetchs: [],
  fakeInstanceMocks: [],
  fetchPolicy: 'network-only',
  suppressRenderErrors: false,
}

let prefetchIDs = {
}

exports.install = function (Vue, options = {}) {
  Globals.Vue = Vue
  Object.assign(config, options)
}

exports.globalPrefetch = function (handler) {
  config.globalPrefetchs.push(handler)
}

exports.mockInstance = function (plugin) {
  config.fakeInstanceMocks.push(plugin)
}

exports.prefetchAll = function (isCacheFirst, apolloProvider, prefetchID, components = [], context = {}) {
  const globalPrefetchs = config.globalPrefetchs.map(handler => handler(context)).filter(Boolean)
  return exports.getQueriesFromTree(components.concat(globalPrefetchs), context)
    .then(queries => Promise.all(queries.map(
      query => prefetchQuery(isCacheFirst, apolloProvider, prefetchID, query, context)
    )))
}

exports.getQueriesFromTree = function (components, context) {
  const queries = []
  return Promise.all(
    components.map(component => walkTree(component, {}, undefined, [], context, queries, components))
  ).then(() => queries)
}

function walkTree (component, data, parent, children, context, queries, components) {
  component = getMergedDefinition(component)
  return new Promise((resolve, reject) => {
    const queue = []
    data = data || {}
    const vm = createFakeInstance(component, data, parent, children, context)

    // Mocks
    for (const mock of config.fakeInstanceMocks) {
      mock.apply(mock)
    }

    // Render h function
    vm.$createElement = (el, data, children) => {
      if (typeof data === 'string' || Array.isArray(data)) {
        children = data
        data = {}
      }

      // No Prefetch flag
      if (data && data.attrs &&
          data.attrs['no-prefetch'] !== undefined &&
          data.attrs['no-prefetch'] !== false) {
        return
      }

      queue.push(resolveComponent(el, component).then(resolvedComponent => {
        let child
        if (resolvedComponent && !components.includes(resolvedComponent)) {
          child = {
            component: resolvedComponent,
            data,
            children,
          }
        }
        return child
      }))
    }

    prefetchComponent(component, vm, queries)

    try {
      component.render.call(vm, vm.$createElement)
    } catch (e) {
      if (!config.suppressRenderErrors) {
        console.log(chalk.red(`Error while rendering ${component.name || component.__file}`))
        console.log(e.stack)
      }
    }

    Promise.all(queue).then(queue => queue.filter(child => !!child).map(
      child => walkTree(child.component, child.data, vm, child.children, context, queries, components)
    )).then(() => resolve())
  })
}

function prefetchComponent (component, vm, queries) {
  const apolloOptions = component.apollo

  if (!apolloOptions) return
  if (apolloOptions.$prefetch === false) return

  const componentClient = apolloOptions.$client
  for (let key in apolloOptions) {
    const options = apolloOptions[key]
    if (
      key.charAt(0) !== '$' && (
        !options.query || (
          (typeof options.ssr === 'undefined' || options.ssr) &&
          options.prefetch !== false
        )
      )
    ) {
      queries.push({
        queryOptions: options,
        client: options.client || componentClient,
        vm,
      })
    }
  }
}

function prefetchQuery (isCacheFirst, apolloProvider, prefetchID, query, context) {
  try {
    let variables

    let { queryOptions, client, vm } = query

    // Client
    if (typeof client === 'function') {
      client = client.call(vm)
    }
    if (!client) {
      client = apolloProvider.defaultClient
    } else if (typeof client === 'string') {
      client = apolloProvider.clients[client]
      if (!client) {
        throw new Error(`[vue-apollo] Missing client '${client}' in 'apolloProvider'`)
      }
    }

    // Function query
    if (typeof queryOptions === 'function') {
      queryOptions = queryOptions.call(vm)
    }

    // Simple query
    if (!queryOptions.query) {
      queryOptions = {
        query: queryOptions,
      }
    } else {
      const prefetch = queryOptions.prefetch
      const prefetchType = typeof prefetch

      // Resolve variables
      let prefetchResult
      if (prefetchType !== 'undefined') {
        if (prefetchType === 'function') {
          prefetchResult = prefetch.call(vm, context)
        } else if (prefetchType === 'boolean') {
          if (prefetchResult === false) {
            return Promise.resolve()
          }
        } else {
          prefetchResult = prefetch
        }
      }

      if (prefetchResult) {
        variables = prefetchResult
      } else {
        const optVariables = queryOptions.variables
        if (typeof optVariables !== 'undefined') {
          // Reuse `variables` option with `prefetch: true`
          if (typeof optVariables === 'function') {
            variables = optVariables.call(vm)
          } else {
            variables = optVariables
          }
        } else {
          variables = undefined
        }
      }
    }

    // Query
    if (typeof queryOptions.query === 'function') {
      queryOptions.query = queryOptions.query.call(vm)
    }

    // Default query options from apollo provider
    if (apolloProvider.defaultOptions && apolloProvider.defaultOptions.$query) {
      queryOptions = Object.assign({}, apolloProvider.defaultOptions.$query, queryOptions)
    }

    // Remove vue-apollo specific options
    const options = omit(queryOptions, VUE_APOLLO_QUERY_KEYWORDS)
    options.variables = variables
    // Override fetchPolicy
    if (config.fetchPolicy != null) {
      options.fetchPolicy = config.fetchPolicy
    }

    if (isCacheFirst) {
      if (prefetchID !== 0) {
        if (!prefetchIDs[prefetchID]) {
          prefetchIDs[prefetchID] = {time: new Date().getTime(), value: []};
        } 
        // let queryName = queryOptions.query.definitions[0].name.value;
        // console.log(queryOptions.query.definitions);
        // console.log(queryOptions.query.definitions[0].variableDefinitions);
        // console.log(queryOptions.query.definitions[0].selectionSet.selections.name.value);
        for (let i of  queryOptions.query.definitions[0].selectionSet.selections) {
          let variables = {};
          for (let j of i.arguments) {
            console.log(j.value.name);
            let variableName = j.value.name.value;
            variables[variableName] = (queryOptions.variables)()[variableName]
          }
          prefetchIDs[prefetchID].value.push({ name: i.name.value, variables: variables });
        }
        // console.log((queryOptions.variables)());
        // console.log(queryOptions.query.definitions[0].selectionSet.selections); 
        // console.log(queryOptions.query.definitions[0].selectionSet.selections[0].arguments);
        // console.log(queryOptions.query.definitions[0].selectionSet.selections[0].arguments[0].value.name);
        // console.log(JSON.stringify((queryOptions.variables)()));

        // let decap = queryName[0].toLowerCase() + queryName.slice(1);
        // prefetchIDs[prefetchID].value.push(decap);
      }
      options.fetchPolicy = 'cache-first';
    }

    return client.query(options)
  } catch (e) {
    console.log(chalk.red(`[ERROR] While prefetching query`), query, chalk.grey(`Error stack trace:`))
    console.log(e.stack)
  }
}

exports.getStates = function (apolloProvider, options) {
  const finalOptions = Object.assign({}, {
    exportNamespace: '',
  }, options)
  const states = {}
  for (const key in apolloProvider.clients) {
    const client = apolloProvider.clients[key]
    const state = client.cache.extract()
    states[`${finalOptions.exportNamespace}${key}`] = state
  }
  return states
}

function isEquivalent(a, b) {
  // Create arrays of property names
  var aProps = Object.getOwnPropertyNames(a);
  var bProps = Object.getOwnPropertyNames(b);

  // If number of properties is different,
  // objects are not equivalent
  if (aProps.length != bProps.length) {
      return false;
  }

  for (var i = 0; i < aProps.length; i++) {
      var propName = aProps[i];

      // If values of same property are not equal,
      // objects are not equivalent
      if (a[propName] !== b[propName]) {
          return false;
      }
  }

  // If we made it this far, objects
  // are considered equivalent
  return true;
}


checkIsSameQuery = function (queryName, queryDefinition) {
  if (queryName.startsWith(queryDefinition.name)) {
    let variableByQueryName = queryName.slice(queryDefinition.name.length + 1);
    variableByQueryName = variableByQueryName.slice(0, variableByQueryName.length - 1);
    // console.log('kkk', variableByQueryName);
    // console.log('------', queryDefinition.variables);
    // console.log('+++++++', JSON.parse(variableByQueryName));
    if (isEquivalent(queryDefinition.variables, JSON.parse(variableByQueryName || '{}'))) {
      console.log('+++++++++++++++++++', queryName)
      return true;
    }
  } else {
    return false
  }
}

exports.getStatesK = function (prefetchID, apolloProvider, options) {
  const finalOptions = Object.assign({}, {
    exportNamespace: '',
  }, options)
  const states = {}
  function recursiveAddNode(a, result, state) {
    for (let k in a) {
      if (k == 'id') {
        result[a[k]] = state[a[k]];
      } else if (typeof a[k] === 'object' && a[k]) {
        let m = a[k].id
        result[m] = state[m];
        recursiveAddNode(state[m], result, state)
      }
    }
  }
  for (const key in apolloProvider.clients) {
    const client = apolloProvider.clients[key]
    const state = client.cache.extract()
    let result = {}
    if (prefetchID in prefetchIDs) {
      // console.log('ROOT_QUERY: ', state['ROOT_QUERY'])
      result['ROOT_QUERY'] = state['ROOT_QUERY'];
      for (let i in state['ROOT_QUERY']) {
        for (let j of prefetchIDs[prefetchID].value) {
          // console.log('i: ', i, 'j: ', j);
          // console.log(j, 'j');
          // console.log(i, 'i');
          if (checkIsSameQuery(i, j)) {
              recursiveAddNode(state['ROOT_QUERY'][i], result, state)
          }
        }
      }
      states[`${finalOptions.exportNamespace}${key}`] = result;
    } else {
      states[`${finalOptions.exportNamespace}${key}`] = state
    }
  }
  delete prefetchID[prefetchID]
  return states
}

exports.exportStates = function (apolloProvider, options) {
  const finalOptions = Object.assign({}, {
    globalName: '__APOLLO_STATE__',
    attachTo: 'window',
  }, options)
  const states = exports.getStates(apolloProvider, finalOptions)
  const js = `${finalOptions.attachTo}.${finalOptions.globalName} = ${JSON.stringify(states)};`
  return js
}
