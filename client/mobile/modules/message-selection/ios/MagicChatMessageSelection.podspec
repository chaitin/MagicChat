require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MagicChatMessageSelection'
  s.version        = package['version']
  s.summary        = 'Bridges native message selection actions to MagicChat.'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'MagicChat'
  s.homepage       = 'https://baizhi.cloud/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
