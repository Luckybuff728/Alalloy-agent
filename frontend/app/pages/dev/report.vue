<template>
  <ReportPreview />
</template>

<script setup>
import ReportPreview from '../../dev/ReportPreview.vue'

// 仅开发模式可访问
definePageMeta({ layout: false })
</script>
