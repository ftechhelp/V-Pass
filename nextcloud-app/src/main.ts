import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.ts'
import './styles/app.scss'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#content')
