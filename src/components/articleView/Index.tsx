import React, { MutableRefObject, PropsWithChildren, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Dimensions, Linking, NativeModules, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import articleApi from '~/api/article'
import store from '~/redux'
import { articleViewHOC, ArticleViewConnectedProps } from '~/redux/articleView/HOC'
import { userHOC, UserConnectedProps } from '~/redux/user/HOC'
import request from '~/utils/request'
import storage from '~/utils/storage'
import toast from '~/utils/toast'
import { controlsCodeString } from './controls/index'
import { scriptCodeString } from './scripts'
import { ArticleApiData } from '~/api/article.d'
import homeStyleSheet from './styles/home'
import articleStyleSheet from './styles/article'
import { DOMParser } from 'react-native-html-parser'

const styleSheets = {
  home: homeStyleSheet,
  article: articleStyleSheet
}

export type InjectStyleSheetName = keyof typeof styleSheets

export interface Props {
  navigation: __Navigation.Navigation
  style?: StyleProp<ViewStyle>
  link?: string
  html?: string
  disabledLink?: boolean
  injectStyle?: InjectStyleSheetName[]
  injectCss?: string
  injectJs?: string
  autoPaddingTopForHeader?: boolean
  onMessages?: { [msgName: string]: (data: any) => void }
  onLoaded? (articleData: ArticleApiData.GetContent): void
  onMissing? (link: string): void
  getRef: MutableRefObject<any>
}

export interface ArticleViewRef {
  loadContent (forceLoad?: boolean): void
  injectScript (script: string): void
}

(ArticleView as DefaultProps<Props>).defaultProps = {
  onLoaded: () => {},
  onMissing: () => {}
}

type FinalProps = Props & UserConnectedProps & ArticleViewConnectedProps

function ArticleView(props: PropsWithChildren<FinalProps>) {
  const [html, setHtml] = useState('')
  const [originalImgUrls, setOriginalImgUrls] = useState<{ name: string, url: string }[]>()
  const [articleData, setArticleData] = useState<ArticleApiData.GetContent>()
  const [status, setStatus] = useState(1)
  const config = useRef(store.getState().config)
  const refs = {
    webView: useRef<any>()
  }

  if (props.getRef) props.getRef.current = { loadContent, injectScript }

  const libScript = ['fastclick.min', 'jquery.min', 'hammer.min']
  const baseUrl = 'file:///android_asset/assets'

  useEffect(() => {
    const listener = props.navigation.addListener('willFocus', () => {
      // 获取配置，注入webView
      let newConfig = store.getState().config
      if (JSON.stringify(config.current) !== JSON.stringify(newConfig || {})) {
        config.current = newConfig
        if (props.html) {
          setHtml(createDocument(props.html))
        } else {
          loadContent()
        }
      }
    })

    return () => listener.remove()
  }, [])

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (global.$isVisibleLoading) {
        toast.hide()
        return true
      }
    })

    return () => listener.remove()
  }, [])

  useEffect(() => {
    if (props.link) {
      loadContent()
    } else {
      setHtml(createDocument(props.html!))
      setStatus(3)
    }
  }, [])

  function createDocument(content: string, categories?: string[]) {
    let injectRequestUtil = function() {
      // 注入一个请求器，用于通信
      window._request = function(config, callback) {
        if (!window._request_id) window._request_id = 0 

        let callbackName = '_request_' + window._request_id
        
        ;(window as any)[callbackName] = callback
        window._request_id++

        // 必须返回，之后单独使用postMessage发送出去，不能对postMessage进行封装，否则webView无法接收到
        return { config, callbackName }
      }
    }.toString()

    injectRequestUtil = `(${injectRequestUtil})();`

    const scriptTags = libScript.reduce((prev, next) => prev + `<script src="js/lib/${next}.js"></script>`, '')

    let injectJsCodes = `
      ${global.__DEV__ ? 'try{' : ''}
        ${injectRequestUtil};
        ${scriptCodeString};
        ${controlsCodeString};
        ${props.injectJs || ''}
      ${global.__DEV__ ? `
        }catch(e){
          ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', data: { name: e.name, message: e.message } }))
        }
      ` : ''}
    `

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="ie=edge">
        <title>Document</title>
        <style>${props.injectStyle ? props.injectStyle.map(name => styleSheets[name]).join('') : ''}</style>
        ${props.autoPaddingTopForHeader ? `
          <style>
            body {
              padding-top: ${store.getState().config.immersionMode ? 55 : 55 + NativeModules.StatusBarManager.HEIGHT}px;
              padding-bottom: 70px;
            }
          </style>
        ` : ''}
        <style>${props.injectCss || ''}</style>
      </head>
      <body>
        <div id="articleContentContainer" style="padding:0 5px; box-sizing:border-box;">${content}</div>
        ${scriptTags}
        <script>
          console.log = val => ReactNativeWebView.postMessage(JSON.stringify({ type: 'print', data: val }))
          window._appConfig = ${JSON.stringify(config.current || {})}
          window._colors = ${JSON.stringify($colors)}
          window._categories = ${JSON.stringify(categories)}
          $(function(){ 
            ${injectJsCodes};
          })
        </script>
      </body>
      </html>        
    `
  }

  function loadOriginalImgUrls(imgs: string[]): Promise<{ url: string, name: string }[]> {
    return Promise.all(
      imgs.map(articleApi.getImageUrl)
    )
      .then((urls: string[]) => {
        const imgUrls = urls.map((url, index) => ({ url, name: imgs[index] }))
        setOriginalImgUrls(imgUrls)
        return imgUrls
      })
  }

  function loadContent(forceLoad = false) {
    if (status === 2) { return }
    setStatus(2)
    props.$articleView.getContent(props.link!, forceLoad)
      .then(data => {
        let html = data.parse.text['*']
        // 如果为分类页，则从html字符串中抽取数据，然后交给category界面处理
        if (/^([Cc]ategory|分类):/.test(props.link!)) {
          const htmlDoc = new DOMParser().parseFromString(html, 'text/html')
          let categoryBranchContainer = htmlDoc.getElementById('topicpath')
          let descContainer = htmlDoc.getElementById('catmore')
          let categoryBranch: string[] | null = null
          let articleTitle: string | null = null

          if (categoryBranchContainer) {
            categoryBranch = Array.from(categoryBranchContainer.getElementsByTagName('a')).map(item => item.textContent!)
          }
          if (descContainer) {
            articleTitle = descContainer.getElementsByTagName('a')[0].getAttribute('title')
          }

          return props.navigation.replace('category', { 
            title: props.link!.split(':')[1], 
            branch: categoryBranch,
            articleTitle 
          })
        }
        
        console.log(data)
        setHtml(createDocument(html, data.parse.categories.map(item => item['*'])))
        setStatus(3)
        props.onLoaded && props.onLoaded(data)
        // 无法显示svg，这里过滤掉
        loadOriginalImgUrls(data.parse.images.filter(imgName => !/\.svg$/.test(imgName)))
        setArticleData(data)
      })
      .catch(async e => {
        console.log(e)
        if (e && e.code === 'missingtitle') return props.onMissing && props.onMissing(props.link!)

        try {
          const redirectMap = await storage.get('articleRedirectMap') || {}
          let link = redirectMap[props.link!] || props.link
          const articleCache = await storage.get('articleCache') || {}
          const data = articleCache[link!]
          if (data) {
            let html = data.parse.text['*']
            setHtml(createDocument(html, data.parse.categories.map(item => item['*'])))
            $dialog.snackBar.show('因读取失败，载入条目缓存')
            setStatus(3)
            props.onLoaded && props.onLoaded(data)
            loadOriginalImgUrls(data.parse.images.filter(imgName => !/\.svg$/.test(imgName)))
            setArticleData(data)
          } else {
            throw new Error()
          }
        } catch (e) {
          console.log(e)
          toast.show('网络超时，读取失败')
          setStatus(0)
        }
      })
  }

  function injectScript(script: string) {
    refs.webView.current.injectJavaScript(script)
  }

  function receiveMessage(event: any) {
    type EventParamsMap = {
      print: string
      error: string
      onPressNote: { content: string }
      request: {
        config: {
          url: string
          method: 'get' | 'post'
          params: object
        }
        callbackName: string
      }
      onPressLink: {
        type: 'inner' | 'outer' | 'notExists'
        link: string
      }
      openApp: { url: string }
      onPressEdit: {
        page: string
        section: number
      }
      onPressImage: { name: string }
      onPressBiliVideo: {
        avId: string | number
        page: string | number
      }
    }

    const { type, data }: { type: keyof EventParamsMap, data: EventParamsMap[keyof EventParamsMap] } = JSON.parse(event.nativeEvent.data)

    // 拿这个函数做数据结构映射
    function setEventHandler<EventName extends keyof EventParamsMap>(eventName: EventName, handler: (data: EventParamsMap[EventName]) => void) {
      eventName === type && handler(data as any)
    } 

    setEventHandler('print', msg => console.log('=== print ===', msg))
    setEventHandler('error', msg => console.log('--- WebViewError ---', msg))
    setEventHandler('onPressNote', data => {
      $dialog.alert.show({
        title: '注释',
        content: data.content,
        checkText: '关闭'
      })
    })
    setEventHandler('request', data => {
      let { config, callbackName } = data

      request({
        baseURL: config.url,
        method: config.method,
        params: config.params
      }).then(data => {
        // 数据中的换行会导致解析json失败
        injectScript(`window['${callbackName}'](${JSON.stringify(data).replace(/\\n/g, '')})`)
      }).catch(e => {
        console.log(e)
        injectScript(`window['${callbackName}']('${JSON.stringify({ error: true })}')`)
      })
      
    })

    if (props.disabledLink) { return }
    
    setEventHandler('onPressLink', data => {
      ;({
        inner: () => {
          let [link, anchor] = data.link.split('#')
          props.navigation.push('article', { link, anchor }) 
        },

        outer () {
          Linking.openURL(data.link)
        },

        notExists () {
          $dialog.alert.show({ content: '该条目还未创建' })
        }
      })[data.type]()
    })
    setEventHandler('openApp', data => Linking.openURL(data.url))
    setEventHandler('onPressEdit', data => {
      if (props.state.user.name) {
        props.$user.getUserInfo()
          .then(userInfoData => {
            if (userInfoData.query.userinfo.implicitgroups.includes('autoconfirmed')) {
              props.navigation.push('edit', { title: data.page, section: data.section })
            } else {
              $dialog.alert.show({
                title: '抱歉，暂不支持非自动确认用户编辑',
                content: '请先通过网页端进行编辑10次以上，且注册时间超过24小时，即成为自动确认用户。'
              })
            }
          })
      } else {
        $dialog.confirm.show({
          content: '登录后才可以进行编辑，要前往登录界面吗？',
          onPressCheck: () => props.navigation.push('login')
        })
      }
    })
    setEventHandler('onPressImage', data => {
      if (originalImgUrls) {
        props.navigation.push('imageViewer', { 
          imgs: originalImgUrls.map(img => ({ url: img.url })),
          index: originalImgUrls.findIndex(img => img.name === data.name)
        })
      } else {
        toast.showLoading('获取链接中')
        articleApi.getImageUrl(data.name)
          .finally(toast.hide)
          .then(url => {
            props.navigation.push('imageViewer', { imgs: [{ url }], index: 0 })
          })
      }
    })
    setEventHandler('onPressBiliVideo', data => props.navigation.push('biliPlayer', data))

    if (props.onMessages) {
      ;(props.onMessages[type] || (() => {}))(data)
    }
  }

  return (
    <View style={{ ...styles.container, ...(props.style as any) }}>
      {({
        0: () => 
          <TouchableOpacity onPress={() => loadContent(true)}>
            <Text style={{ fontSize: 18, color: $colors.primary }}>重新加载</Text>
          </TouchableOpacity>,
        1: () => null,
        2: () => <ActivityIndicator color={$colors.primary} size={50} />,
        3: () => 
          <WebView allowFileAccess domStorageEnabled
            scalesPageToFit={false}
            source={{ html, baseUrl }}
            originWhitelist={['*']}
            style={{ width: Dimensions.get('window').width }}
            onMessage={receiveMessage}
            ref={refs.webView}
          />
      } as { [status: number]: () => JSX.Element | null })[status]()}
    </View>
  )
}

export default articleViewHOC(userHOC(ArticleView))

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  }
})