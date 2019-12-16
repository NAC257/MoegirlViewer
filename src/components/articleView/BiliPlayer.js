import React from 'react'
import PropTypes from 'prop-types'
import Orientation from 'react-native-orientation'
import StatusBar from '~/components/StatusBar'
import {
  View, Text,
  StyleSheet
} from 'react-native'
import WebView from 'react-native-webview'

function BiliPlayer(props){
  const avId = props.navigation.getParam('avId')
  const page = props.navigation.getParam('page')

  function createDocument (){
    let js = (function(){
      window.addEventListener('fullscreenchange', function(){
        ReactNativeWebView.postMessage(JSON.stringify({ type: 'onFullScreenChange', data: { isFullScreen: !!document.fullscreenElement } }))
      })
    }).toString()

    // 要传入的html代码
    let injectJsCodes = `
      ${global.__DEV__ ? 'try{' : ''}
        ;(${js})();
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
        <style>
          html{
            height: 100%;
          }

          body{
            height: 100%;
            background: black;
            display: flex;
            align-items: center;
          }
        </style>
      </head>
      <body>
        <iframe src="https://player.bilibili.com/player.html?aid=${this.avId}&page=${this.page}" scrolling="no" framespacing="0" border="0" frameborder="no"  allowfullscreen="true" style="width:100%; background-color:#ccc;" class="bilibili-player"></iframe>
        <script>
          console.log = val => ReactNativeWebView.postMessage(JSON.stringify({ type: 'print', data: val }))
          ${injectJsCodes};
        </script>
      </body>
      </html>      
    `
  }

  function receiveMessage(e){
    const {type, data} = JSON.parse(e.nativeEvent.data)

    if(type === 'print'){
      console.log('=== print ===', data)
    }

    if(type === 'error'){
      console.log('--- WebViewError ---', data)
    }

    if(type === 'onFullScreenChange'){
      data.isFullScreen ? Orientation.lockToLandscape() : Orientation.lockToPortrait()
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar hidden />
      <WebView allowsFullscreenVideo
        scalesPageToFit={false}
        source={{ html: createDocument() }}
        onMessage={receiveMessage}
      />
    </View>
  )
}

export default BiliPlayer