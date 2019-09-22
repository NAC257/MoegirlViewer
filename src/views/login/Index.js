import React from 'react'
import PropTypes from 'prop-types'
import {
  View, Text,
  StyleSheet
} from 'react-native'
import StatusBar from '~/components/StatusBar'
import userStore from '~/redux/user'

export default class Login extends React.Component{
  static propTypes = {
    
  }

  constructor (props){
    super(props)
    this.state = {
      
    }
  }

  componentWillMount (){
    userStore.subscribe(() =>{
      
    })
  }

  componentDidMount (){
    userStore._async.login('東東君', 'zhang18640311631').then(data => console.log(data)).catch(e => console.log(e))
  }
  
  render (){
    return (
      <View>
        <StatusBar blackText color="white" />
        <Text>login</Text>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  
})